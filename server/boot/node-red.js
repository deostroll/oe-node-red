/**
 *
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
/**
 * This is a loopback boot script that integrates and starts Node-RED within the
 * oe-cloud based application.
 * The integrated Node-RED can be accessed on the application port itself with "/red" URL.
 */

var RED = require('node-red');
var loopback = require('loopback');
var log = require('oe-logger')('node-red');
var bodyParser = require('body-parser');
var fs = require('fs');
var path = require('path');
var events = require('events');
var eventEmitter = new events.EventEmitter();
var uuidv4 = require('uuid/v4');
var NodeRedFlows = loopback.getModelByType('NodeRedFlow');
var settings;
var TAG = '    * ';

// The boot function
module.exports = function startNodeRed(app, callback) {
  // initialize app with oe-cloud specific handlers
  // Do not proceed if initApp fails, i.e., returns false
  if ((initApp(app)) === false) {
    return callback();
  }

  // Initialise the Node-RED runtime with a server and settings
  RED.init(app.server, settings);

  // Serve the editor UI on httpAdminRoot path
  app.use(settings.httpAdminRoot, RED.httpAdmin);

  // Serve the http nodes UI from /api
  app.use(settings.httpNodeRoot, RED.httpNode);

  // Start the runtime
  // RED.stop();
  RED.start();
  callback();
};

// initializes app with oe-cloud specific handlers
function initApp(app) {
  // Modifying createNode function to inject callContext into msg
  var _createNode = RED.nodes.createNode;
  RED.nodes.createNode = function (thisnode, config) {
    thisnode.on('input', function (msg) {
      msg.callContext = config.callContext;
    });
    _createNode(thisnode, config);
  };

  var redEvents = RED.events;
  redEvents.on('nodes-started', function () {
    // eslint-disable-next-line no-console
    console.log('[' + new Date().toISOString() + '] ', 'INFO: Node-RED nodes (re)started');
  });

  // parse application/x-www-form-urlencoded
  var urlEncodedOpts = app && app.get('remoting') && app.get('remoting').urlencoded ? app.get('remoting').urlencoded : { extended: false, limit: '2048kb' };
  app.use(bodyParser.urlencoded(urlEncodedOpts));

  // parse application/json
  var jsonOpts = app && app.get('remoting') && app.get('remoting').json ? app.get('remoting').json : { limit: '2048kb' };
  app.use(bodyParser.json(jsonOpts));


  // Create the settings object - server/config.json:nodeRedSettings will be used if present
  // else minimal default values will be used from this code
  settings = getSettings(app);

  // Do not continue if settings are not available
  /* istanbul ignore if */
  if (!settings) return false;

  // Add a check for node-red-admin role only if 'enableNodeRedAdminRole' is true
  if (app.get('enableNodeRedAdminRole') === true) {
    // Get nodeRedAdminRoles from settings, defaulting to NODE_RED_ADMIN
    var nodeRedAdminRoles = app.get('nodeRedAdminRoles') ? app.get('nodeRedAdminRoles') : ['NODE_RED_ADMIN'];
    app.use(function (req, res, next) {
      // Apply admin check only for URLs beginning with httpAdminRoot(default: /red)
      if (req.url.startsWith(settings.httpAdminRoot) &&  !isNodeRedAdmin(req, nodeRedAdminRoles)) {
        /* istanbul ignore next */
        logError();
        return res.status(401).json({
          error: 'unauthorized'
        });
      }
      next();
    });
  }

  /* istanbul ignore next */
  function logError() {
    // eslint-disable-next-line no-console
    console.error('Node-RED UI usage is disabled for non-admin roles by setting enableNodeRedAdminRole = true in config.json');
    // eslint-disable-next-line no-console
    console.error('Valid Node-RED admin roles should be configured (array) in nodeRedAdminRoles property of config.json');
    // eslint-disable-next-line no-console
    console.error('The logged in user should have one of the roles in nodeRedAdminRoles property of config.json');
    // eslint-disable-next-line no-console
    console.error('If no nodeRedAdminRoles property is specified in config.json, NODE_RED_ADMIN is used as default Node-RED admin role.');
  }


  eventEmitter.on('reloadNodeRedFlows', function (version) {
    // eslint-disable-next-line no-console
    console.log('Reload Flows Called');
    // RED.nodes.loadFlows();
  });

  // Trap requests from Node-RED UI for fetching and saving flows
  // This is for manipulating the visibility of flows
  app.use(function (req, res, next) {
    // Intercept '/red/flows' URL, used to save and get flows from the NR UI
    if (req.url.startsWith(settings.httpAdminRoot + '/flows')) {
      // If NR UI is saving flows (which is just the current user's flows),
      // remove all flows belonging to current user from DB, and save the
      // current flows from request to DB
      if (req.method === 'POST') {
        // Get the current user flows from request
        var userFlows = req.body.flows;
        // Remove all flows of current user from DB
        NodeRedFlows.remove({}, req.callContext, function findCb(err, results) {
          /* istanbul ignore if */
          if (err) {
            // eslint-disable-next-line no-console
            console.log(err);
          } else {
            // variable to hold transformed userFlow data (suitable for database insert)
            var newFlows = [];
            /* istanbul ignore else */
            if (userFlows && userFlows.length > 0) {
              userFlows.forEach(function (newFlow) {
                newFlows.push({id: newFlow.id, node: newFlow});
              });
              // Save newFlows (flows the surrent user tried to save) to DB
              NodeRedFlows.create(newFlows, req.callContext, function (err, results1) {
                /* istanbul ignore if */
                if (err) {
                  // eslint-disable-next-line no-console
                  console.log(err);
                } else {
                    eventEmitter.emit('reloadNodeRedFlows', uuidv4());
                }
                next();
              });

              // To be able to have flows developed in source-control (Git), as well as to
              // be able to support migration to production, we also save the flow data
              // to a file. We do this in non-production mode only.
              /* istanbul ignore else */
              if (process.env.NODE_ENV !== 'production') {
                var flowFilePath = settings.userDir + '/' + settings.flowFile;
                fs.writeFile(flowFilePath, JSON.stringify(newFlows, null, 4), function (err) {
                  /* istanbul ignore if */
                  if (err) {
                    // eslint-disable-next-line no-console
                    console.log(err);
                  }
                });
              }
            }
          }
        });


        // If NR is fetching flows, the request triggers NR to call getFlows()
        // of the storage module. The getFlows() has to return all flows in the DB, as
        // NR caches the result and uses the result as the "complete" list of flows to
        // execute. Since the NR UI should show only the current user's flows, the result
        // of storage.getFlows() should not be sent as-is as the response of this GET request.
        // To achieve this, we override the response.send() function, and in its implementation,
        // we send only the flows belonging to the current user, after querying them from the DB
      } else
      /* istanbul ignore else */
      if (req.method === 'GET') {
        // array that will hold the current user's flows that will be sent back to NR UI
        var userflows = [];

        // Replacing res.send with our own function
        var send = res.send;
        res.send = function (body) {
          var bodyString = body instanceof Buffer ? body.toString() : body;
          if (!bodyString) bodyString = '{}';
          var jsonBody = JSON.parse(bodyString);
          // Get the current revision of NR Flows that was sent from the UI
          var rev = jsonBody && jsonBody.rev ? jsonBody.rev : null;

          var self = this;
          // Fetch currentUserFlows from DB
          NodeRedFlows.find({}, req.callContext, function findCb(err, currentUserFlows) {
            /* istanbul ignore if */
            if (err) {
              // eslint-disable-next-line no-console
              console.log(err);
            } else
            /* istanbul ignore else */
            if (currentUserFlows) {
              // Transform the format of currentUserFlows to make it suitable for sending to NR UI
              currentUserFlows.forEach(function (result) {
                userflows.push(result.node);
              });
            }
            // Creating new body to send back to NR UI
            var newBody = JSON.stringify({ flows: userflows, rev: rev });
            // Call original request.send function to actually send the data back to NR UI
            send.call(self, newBody);
          });
        };
        next();
      }
    } else next();
  });

  return true;
}


// This function returns a Node-RED settings object. Settings is set to the nodeRedSettings
// property of the application's server/config.json, if it is present.
// Else, it is set to a sane default.
// Here Node-RED can be disabled by setting env variable DISABLE_NODE_RED_PROJECTS to true or 1
function getSettings(app) {
  /* istanbul ignore if */
  if (app.get('disableNodeRed') === true) {
    log.warn(TAG + 'oe-node-red (Node-RED integration) is DISABLED via config.json: (disableNodeRed: true)');
    // eslint-disable-next-line no-console
    console.error(TAG, 'oe-node-red (Node-RED integration) is DISABLED via config.json: (disableNodeRed: true)');
    return false;
  }
  /* istanbul ignore if */
  if (process.env.DISABLE_NODE_RED === 'true' || process.env.DISABLE_NODE_RED === '1') {
    log.warn(TAG + 'oe-node-red (Node-RED integration) is DISABLED via environment variable: (DISABLE_NODE_RED = ' + process.env.DISABLE_NODE_RED);
    // eslint-disable-next-line no-console
    console.error(TAG, 'oe-node-red (Node-RED integration) is DISABLED via environment variable: (DISABLE_NODE_RED = ' + process.env.DISABLE_NODE_RED);
    return false;
  }
  log.warn(TAG + 'oe-node-red (Node-RED integration) is ENABLED by default. (To disable, set disableNodered: true in server/config.json)');

  var userDir;
  var settingsPath;
  var fileSettings;
  /* istanbul ignore else */
  if (typeof global.it === 'function') {
    settingsPath = path.resolve(process.cwd(), 'test', 'node-red-settings.js');
    userDir = 'test/';
  } else {
    userDir = 'nodered/';
    settingsPath = path.resolve(process.cwd(), 'server', 'node-red-settings.js');
  }

  var settings = {
    httpAdminRoot: '/red',
    httpNodeRoot: '/redapi',
    userDir: userDir,
    nodesDir: '../nodes',
    flowFile: 'node-red-flows.json',
    editorTheme: { palette: { editable: false }},
    flowFilePretty: true,
    credentialSecret: 'my-random-string',
    functionGlobalContext: {
      loopback: require('loopback'),
      logger: require('oe-logger')('node-red-flow')
    }
  };

  try {
    fileSettings = require(settingsPath);
  } catch (e) {
    log.warn(TAG, 'node-red-settings.js not found at ' + settingsPath + '. Will use defaults from code.');
  }

  /* istanbul ignore else */
  if (fileSettings) {
    Object.keys(fileSettings).forEach(function (param) {
      settings[param] = fileSettings[param];
    });
  }

  /* istanbul ignore else */
  if (!settings.logging) {settings.logging = { 'oe-logger': { handler: initLogger }};}

  /* istanbul ignore else */
  if (!settings.server) {settings.server = app;}

  // We're always saving flows to DB, but parallely will save to file too for source-control and migration needs.
  var storageModulePath = '../../lib/oe-node-red-storage';
  /* istanbul ignore else */
  if (!settings.storageModule) {settings.storageModule = require(storageModulePath);}

  log.info(TAG, 'Node-RED Admin Role is ' + (app.get('enableNodeRedAdminRole') === true ? 'ENABLED' : 'DISABLED') + ' via setting in server/config.json - enableNodeRedAdminRole: ' + app.get('enableNodeRedAdminRole'));
  log.info(TAG, (app.get('enableNodeRedAdminRole') === true ? 'Only users with nodeRedAdminRoles (see server/config.json)' : 'Any logged in user') + ' can use Node-RED');
  log.info(TAG, 'Node-RED Starting at http://<this_host>:' + app.get('port') + settings.httpAdminRoot);
  log.info(TAG, '');
  log.info(TAG, 'See documentation at http://evgit/oec-next/oe-node-red/ for details on oe-node-red settings');
  return settings;
}


// Function to check if the current request came from a logged-in user
// who has a node-red admin role. Node-RED admins can be specified
// in config.json using the 'nodeRedAdminRoles' array property.
// If this property is absent, but node-red admin is still enabled,
// then a default role called NODE_RED_ADMIN is used.
function isNodeRedAdmin(req, nodeRedAdminRoles) {
  if (!nodeRedAdminRoles || !nodeRedAdminRoles.length) {
    log.warn(TAG + 'nodeRedAdminRoles is invalid. Should be a string array.');
    return false;
  }
  var result = false;
  if (req.accessToken) {
    var instance = req.accessToken.__data;
    if (instance && instance.roles) {
      for (var i = 0; i < nodeRedAdminRoles.length; i++) {
        result = instance.roles.includes(nodeRedAdminRoles[i]);
        if (result) break;
      }
    }
  }
  return result;
}


// This function is used to configure Node-RED's logging
function initLogger(settings) {
  // Logs message as per log level
  function logger(msg) {
    var levelNames = {  10: 'fatal', 20: 'error', 30: 'warn', 40: 'info', 50: 'debug', 60: 'trace', 98: 'audit', 99: 'metric'};
    var level = levelNames[msg.level];
    /* istanbul ignore next */
    switch (level) {
      case 'metric':
        log.trace(log.defaultContext(), msg.msg);
        break;
      case 'audit':
        log.trace(log.defaultContext(), msg.msg);
        break;
      case 'trace':
        log.trace(log.defaultContext(), msg.msg);
        break;
      case 'debug':
        log.debug(log.defaultContext(), msg.msg);
        break;
      case 'info':
        log.info(log.defaultContext(), msg.msg);
        break;
      case 'warn':
        log.warn(log.defaultContext(), msg.msg);
        break;
      case 'error':
        log.error(log.defaultContext(), msg.msg);
        break;
      case 'fatal':
        log.fatal(log.defaultContext(), msg.msg);
        break;
      default:
        break;
    }
  }
  return logger;
}


