/**
 *
 * ©2018-2019 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
/**
 * This is a loopback boot script that integrates and starts Node-RED within the
 * oe-cloud based application.
 * The integrated Node-RED can be accessed on the application port itself with "/red" URL.
 */

const RED = require('node-red');
const loopback = require('loopback');
const log = require('oe-logger')('node-red');
const bodyParser = require('body-parser');
const path = require('path');
const events = require('events');
const _ = require('lodash');
var fs = require('fs');
var eventEmitter = new events.EventEmitter();
var NodeRedFlows = loopback.getModelByType('NodeRedFlow');
var settings;
var TAG = '    * ';
var flagOnce = true;


// Atul : This function creates wrapper for node-red function while create node.
// when node-red node class instance is being created, it sets the context to the node.
function nodeRedWrapper() {
  const _createNode = RED.nodes.createNode;
  RED.nodes.createNode = function (node, def) {
    _createNode(node, def);
    node.callContext = def.callContext;
    if (flagOnce) {
      flagOnce = false;
      node.constructor.super_.prototype._receive = node.constructor.super_.prototype.receive;
      node.constructor.super_.prototype.receive = function receiveFn(msg) {
        if (!msg) {
          msg = {};
        }
        msg.callContext = this.callContext;
        this._receive(msg);
      };
      node.constructor.super_.prototype._on_ = node.constructor.super_.prototype._on;
      node.constructor.super_.prototype._on = function onEventHandlerFn(event, callback) {
        return this._on_(event, function onEventCb(msg) {
          if (!msg) {
            msg = {};
          }
          msg.callContext = this.callContext;
          callback.call(this, msg);
        });
      };
    }
  };
}

// Atul : This function will refresh the flows for given context.
// Delete all existing flows and refresh from POSTed flows.
// Design issue - we are relying on node.id posted from client. Theoratically, it can be manipulated
function handlePost(req, res, cb) {
  var reqFlows = req.body.flows;
  var redNodes = RED.nodes;
  var nodeFlows = redNodes.getFlows();

  var allflows = [];
  var flowModel = loopback.findModel('NodeRedFlow');
  flowModel.find({}, req.callContext, function (err, dbFlows) {
    if (err) {
      return cb(err);
    }
    if (nodeFlows && nodeFlows.flows && nodeFlows.flows.forEach) {
      nodeFlows.flows.forEach(function (item) {
        allflows.push(item);
      });
    }
    if (dbFlows && dbFlows.forEach) {
      dbFlows.forEach(function (item) {
        _.remove(allflows, function removeFn(o) {
          if (!item.node) {
            return false;
          }
          return (o.id === item.node.id && o.type === item.node.type);
        });
      });
    }
    if (reqFlows && reqFlows.forEach) {
      reqFlows.forEach(function (item) {
        item.callContext = req.callContext;
        allflows.push(item);
      });
    }

    // To be able to have flows developed in source-control (Git), as well as to
    // be able to support migration to production, we also save the flow data
    // to a file. We do this in non-production mode only.
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      var flowFilePath = settings.userDir + '/' + settings.flowFile;
      var exportFilePath = settings.userDir + '/export.json';
      fs.writeFile(flowFilePath, JSON.stringify(allflows.map(function (n) { return { _id: n.id, node: n }; }), null, 4), function (err) {
        /* istanbul ignore if */
        if (err) {
          // eslint-disable-next-line no-console
          console.log(err);
        }
      });
      fs.writeFile(exportFilePath, JSON.stringify(allflows, null, 4), function (err) {
        /* istanbul ignore if */
        if (err) {
          // eslint-disable-next-line no-console
          console.log(err);
        }
      });
    }

    return cb(null, allflows);
  });
}

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

  var redEvents = RED.events;
  redEvents.on('nodes-started', function () {
    // eslint-disable-next-line no-console
    console.log('[' + new Date().toISOString() + '] ', 'INFO: Node-RED nodes (re)started');
  });

  nodeRedWrapper();
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
      if (req.url.startsWith(settings.httpAdminRoot) && !isNodeRedAdmin(req, nodeRedAdminRoles)) {
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
        handlePost(req, res, function (err, flows) {
          if (err) {
            return next(new Error(err));
          }
          req.body.flows = flows;
          return next();
        });
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
    editorTheme: { palette: { editable: false } },
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
  if (!settings.logging) { settings.logging = { 'oe-logger': { handler: initLogger } }; }

  /* istanbul ignore else */
  if (!settings.server) { settings.server = app; }

  // We're always saving flows to DB, but parallely will save to file too for source-control and migration needs.
  var storageModulePath = '../../lib/oe-node-red-storage';
  /* istanbul ignore else */
  if (!settings.storageModule) { settings.storageModule = require(storageModulePath); }

  log.info(TAG, 'Node-RED Admin Role is ' + (app.get('enableNodeRedAdminRole') === true ? 'ENABLED' : 'DISABLED') + ' via setting in server/config.json - enableNodeRedAdminRole: ' + app.get('enableNodeRedAdminRole'));
  log.info(TAG, (app.get('enableNodeRedAdminRole') === true ? 'Only users with nodeRedAdminRoles (see server/config.json)' : 'Any logged in user') + ' can use Node-RED');
  log.info(TAG, 'Node-RED Starting at http://<this_host>:' + settings.uiPort + settings.httpAdminRoot);
  log.info(TAG, '');
  log.info(TAG, 'See documentation at http://github/EdgeVerve/oe-node-red/ for details on oe-node-red settings');
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
    var levelNames = { 10: 'fatal', 20: 'error', 30: 'warn', 40: 'info', 50: 'debug', 60: 'trace', 98: 'audit', 99: 'metric' };
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


