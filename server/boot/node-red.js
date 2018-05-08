/**
 *
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
/**
 * This is a loopback boot script that integrates and starts Node-RED within the 
 * oe-cloud based application.
 * Node-RED is to be started on a port different from the application port.
 * This can be configured in the server/node-red-settings.js file. Defaults to 3001.
 */


/* eslint-disable no-console, no-loop-func */
var http = require('http');
var express = require("express");
var RED = require("node-red");
var loopback = require('loopback');
var path = require('path');
var _log = require('oe-logger')('node-red');
var bodyParser = require('body-parser');
var messaging = require('../../../oe-cloud/lib/common/global-messaging');
var broadcasterClient = require('../../../oe-cloud/lib/common/broadcaster-client.js');
var uuidv4 = require('uuid/v4');
var NodeRedFlows = loopback.getModelByType('NodeRedFlow');
var options = { ignoreAutoScope: true, fetchAllScopes: true };
var settings;
var TAG = "    * ";
// The boot function
module.exports = function startNodeRed(server, callback) {

    // Starting Node-RED in async mode, so that the rest of the app need
    // not wait for Node-RED to boot.
    callback();

    // Standard code for Node-RED integration in an Express app follows
    // (https://nodered.org/docs/embedding)
    
    // Create an Express app for Node-RED (standard way of NR 
    var app = express();

    // initialize app with oe-cloud specific handlers
    // Do not proceed if initApp fails
    if((initApp(app, server)) === false) {
        return;
    }

    // Create a server
    var server1 = http.createServer(app);

    // Initialise the runtime with a server and settings
    RED.init(server1, settings);

    // Serve the editor UI on httpAdminRoot path
    app.use(settings.httpAdminRoot, RED.httpAdmin);

    // Serve the http nodes UI from /api
    app.use(settings.httpNodeRoot, RED.httpNode);

    var nodeRedPort = settings.uiPort;
    var port = nodeRedPort ? nodeRedPort : 3001;
    server1.listen(port);

    // Start the runtime
    RED.start();
}

// initializes app with oe-cloud specific handlers
function initApp(app, server) {

    // Modifying createNode function to inject callContext into msg 
    var _createNode = RED.nodes.createNode;
    RED.nodes.createNode = function (thisnode, config) {
        thisnode.on('input', function (msg) {
            msg.callContext = config.callContext;
        });
        _createNode(thisnode, config);
    };

    // Set registry so that oe-cloud pre-auth middleware works
    app.registry = loopback.registry;

    // Initialize params required by oe-cloud pre-auth middleware
    var pre_auth_params = {
        "excludeHeadersList": [
            "host",
            "accept-encoding",
            "accept",
            "content-type",
            "content-length",
            "connection",
            "user-agent",
            "x-jwt-assertion",
            "cookie",
            "if-none-match"
        ],
        "queryStringContext": [
            "device-type",
            "location",
            "language",
            "tenant-id"
        ]
    };

    // Call pre_auth midddleware
    var pre_auth = require('../../../oe-cloud/server/middleware/pre-auth-context-populator.js');
    app.use(pre_auth(pre_auth_params));

    // Required for adding access_token to authenticated requests
    var AuthSession = loopback.getModelByType('AuthSession');
    app.use(loopback.token({
        model: AuthSession,
        currentUserLiteral: 'me'
    }));

    // Call post_auth midddleware
    var post_auth = require('../../../oe-cloud/server/middleware/post-auth-context-populator.js');
    app.use(post_auth());

    // parse application/x-www-form-urlencoded
    app.use(bodyParser.urlencoded({
        extended: false
    }));

    // parse application/json
    app.use(bodyParser.json());

    // Create the settings object - server/node-red-settings.js will be used if present
    // else minimal default values will be used from this code, in which case PROJECTS
    // can be enabled/disabled using env var ENABLE_NODE_RED_PROJECTS (set to 1 or true to enable)
    // PROJECTS are disabled by default.
    settings = getSettings(server);

    // Do not continue if settings are not available
    if (!settings) return false;

    // Flag indicating if PROJECTS are enabled
    var projectsEnabled = settings.editorTheme && settings.editorTheme.projects && settings.editorTheme.projects.enabled === true;

    // key used to fetch flows for the NR UI. It decides whether flows are isolated based on 
    // tenant or user. Set 'nodeRedUserScope' to true to make it user specific.
    var flowScope = server.get('nodeRedUserScope') === true ? 'remoteUser' : 'tenantId';

    // Add a check for node-red-admin role only if 'enableNodeRedAdminRole' is true
    if (server.get('enableNodeRedAdminRole') === true) {
        // Get nodeRedAdminRoles from settings, defaulting to NODE_RED_ADMIN
        var nodeRedAdminRoles = server.get('nodeRedAdminRoles') ? server.get('nodeRedAdminRoles') : ["NODE_RED_ADMIN"];
        app.use(function (req, res, next) {
            // Apply admin check only for URLs beginning with httpAdminRoot(default: /red)
            if (req.url.startsWith(settings.httpAdminRoot) &&  !isNodeRedAdmin(req, nodeRedAdminRoles)) {
                return res.status(401).json({
                    error: 'unauthorized'
                });
            }
            next();
        });
    } 

    // Add the hook for publishing 'reloadNodeRedFlows' event message 
    // upon saving a flow, subscribing to the same event, as well as 
    // intercept the '/red/flows/' URL calls from NR UI to make NR multi-tenant - 
    // only if PROJECTS are disabled
    if (!projectsEnabled) {

        // Add hook to publish 'reloadNodeRedFlows'
        NodeRedFlows.observe('after save', function flowModelAfterSave(ctx, next) {
            next();
            messaging.publish('reloadNodeRedFlows', uuidv4());
        });

        // Subscribe to 'reloadNodeRedFlows'
        messaging.subscribe('reloadNodeRedFlows', function reloadNodeRedFlowsFn(version) {
            // Reload flows from storage (DB)
            RED.nodes.loadFlows();
        });

        app.use(function (req, res, next) {
            // Intercept '/red/flows' URL, used to save and get flows from the NR UI
            if (req.url.startsWith(settings.httpAdminRoot + "/flows")) {
                // If NR is saving flows (which is usually a sub-set of all flows in DB),
                // fetch all flows from DB, merge DB results with current flows and set into req
                // for all downstream (NR) use
                if (req.method === "POST") {
                    // Query DB for all flows (for all users/tenants)
                    NodeRedFlows.find({}, options, function findCb(err, results) {
                        if (err) console.log(err);
                        if (!results) results = [];
                        // Get the ids of the current flows in the request, being saved 
                        var newids = req.body.flows.map(function (f) {
                            return f.id;
                        });

                        // initialize empty result array
                        var res = [];
                        var idsToDelete = [];
                        // Get all flows in DB other than the current user/tenant's flows
                        // into the res array, and the current user/tenant's flow ids into idsToDelete array
                        results.forEach(function (f) {
                            if (f.callContext.ctx[flowScope] !== req.callContext.ctx[flowScope]) res.push(f.__data);
                            else idsToDelete.push(f.__data.id);
                        });

                        // Append the flows from current req into res, after adding callContext
                        req.body.flows.forEach(function (f) {
                            if (!f.callContext) f.callContext = req.callContext;
                            res.push(f);
                        });

                        // set the new complete res array (including DB flows and updated flows)
                        // into the request so that NR gets the complete flow list for 
                        // execution and saving
                        req.body.flows = res;

                        // Deleting all nodes that belong to the current user from database
                        // as fresh (possibly updated) nodes will be saved from the current request
                        // via the storage module's saveNodes() function 
                        NodeRedFlows.deleteAll({id: {inq: idsToDelete}}, options, function deleteCb(err, results) {
                            if(err) console.log(err);
                            next();
                        });
                    });

                    // If NR is fetching flows, the request triggers NR to call getFlows()
                    // of the storage module. The getFlows() has to return all flows in the DB, as 
                    // NR caches the result and uses the result a the "complete" list of flows to 
                    // execute. The result of storage.getFlows() is filtered in the following code
                    // based on user/tenant (see flowScope above) and the filtered result is sent
                    // as the response to the NR UI
                } else if (req.method === "GET") {

                    // Result array that will hold the filtered results
                    var result_flows = [];

                    // Replacing res.send with our own function
                    var send = res.send;
                    res.send = function (string) {
                        var body = string instanceof Buffer ? string.toString() : string;
                        if (!body) body = "{}";
                        var json = JSON.parse(body);
                        var rev;
                        if (json && json.flows) {
                            rev = json.rev;
                            // json.flows has all flows from DB, returned by storage.getFlows()
                            // Here, we're filtering this list based on the flowScope, and collecting 
                            // the filtered results in result_flows
                            json.flows.forEach(function (f) {
                                if (f.callContext && f.callContext.ctx && f.callContext.ctx[flowScope] === req.callContext.ctx[flowScope])
                                    result_flows.push(f);
                            });
                        } else {
                            console.log(TAG + "No flows in response, json=", json);
                        }

                        // Setting the results back into the body of the response and sending to client
                        body = JSON.stringify({
                            flows: result_flows,
                            rev: rev
                        });
                        send.call(this, body);
                    };
                    next();
                }
            } else next();
        });

        // If PROJECTS are enabled, don't do any of the above, but just add callContext 
        // while saving flows
    } else {
        app.use(function (req, res, next) {
            if (req.url.startsWith(settings.httpAdminRoot + "/flows")) {
                if (req.method === "POST") {
                    if (req.body && req.body.flows)
                        req.body.flows.forEach(function (f) {
                            if (!f.callContext) f.callContext = req.callContext;
                        });
                    next();
                } else next();
            } else next();
        });
    }
    return true;
}


// This function returns a settings object. Settings is set to the object exported from
// server/node-red-settings.js if it exists. Else, it is set to a sane default.
// In the sane default, PROJECTS are disabled, by default. It can be enabled by setting 
// ENABLE_NODE_RED_PROJECTS to true or 1
function getSettings(server) {
    console.log('\n===================================================================\n');
    if (server.get('disableNodered') === true) {
        console.log(TAG + 'oe-node-red (Node-RED integration) is disabled via config.json: (disableNodered: true)');
        console.log('\n===================================================================\n');

        return false;
    }
    console.log(TAG + 'oe-node-red (Node-RED integration) is ENABLED');
    var settings;
    var fileSettings;
    var projectsEnabled = true;
    try {
        var fileSettings = require('../../../../server/node-red-settings.js');
        // Flag to indicate whether PROJECTS are enabled of not
        projectsEnabled = fileSettings.editorTheme && fileSettings.editorTheme.projects && fileSettings.editorTheme.projects.enabled === true;

    } catch (e) {
        console.log(TAG + 'server/node-red-settings.js Not Found');
        console.log(TAG + "Default Node-RED settings will be provided from code/environment variables.");
    }

    // If server/node-red-settings.js is not found, setup some sane defaults
    // for settings. Use env var ENABLE_NODE_RED_PROJECTS to enable or disable PROJECTS
    if (!fileSettings) {
        var nodeRedUserDir = server.get('nodeRedUserDir');
        if (!nodeRedUserDir) {
            nodeRedUserDir = 'nodered/';
        }
        var nodeRedMetrics = server.get('nodeRedMetrics') || false;
        var nodeRedAudit = server.get('nodeRedAudit') || false;
        projectsEnabled = (process.env["DISABLE_NODE_RED_PROJECTS"] === "true" ||
            process.env["DISABLE_NODE_RED_PROJECTS"] === "1") ? false : true;
        if(process.env["DISABLE_NODE_RED_PROJECTS"]) console.log(TAG + "Node-RED flow Projects are ", projectsEnabled ? "ENABLED" : "DISABLED", "( env variable DISABLE_NODE_RED_PROJECTS =", process.env["DISABLE_NODE_RED_PROJECTS"], projectsEnabled ? "" : " Set this to 'true' or '1' to disable NR Projects", " )");
        else console.log(TAG + "Node-RED flow Projects are ", projectsEnabled ? "ENABLED" : "DISABLED", "( default, when no node-red-settings.js file is present )", " Set env variable DISABLE_NODE_RED_PROJECTS to 'true' or '1' to disable NR Projects");
        // create the default settings object
        settings = {
            editorTheme: {
                projects: {
                    enabled: projectsEnabled
                }
            },
            projectsDir: server.get('flowProjectsDir') ? server.get('flowProjectsDir') : path.join(server.get('nodeRedUserDir'), "projects"),
            httpAdminRoot: '/red',
            httpNodeRoot: '/redapi',
            userDir: projectsEnabled? projectsDir : nodeRedUserDir,   // Setting userDir to projectsDir if Projects are enabled, as this is where NR 
            nodesDir: '../nodes',                                     // stores Projects, and there is no setting provided by NR specifically for projectsDir
            flowFile: 'node-red-flows.json',
            logging: {
                'oe-logger': {
                    handler: initLogger,
                    level: 'metric',
                    metrics: nodeRedMetrics,
                    audit: nodeRedAudit
                }
            },
            server: server,
            flowFilePretty: true,
            credentialSecret: "my-random-string",
            functionGlobalContext: {
                loopback: require('loopback'),
                logger: require('oe-logger')('node-red-flow')
            }
        };
    } else {
        console.log(TAG + "Using Node-RED settings from settings file: server/node-red-settings.js");
        console.log(TAG + "No NR settings are provided in code, except the storage module.");
        settings = fileSettings;
        if(projectsEnabled && settings.projectsDir) 
            settings.userDir = settings.projectsDir;  // See comments on projectsDir/userDir above
    }
    console.log(TAG + "See documentation at http://evgit/oecloud.io/oe-node-red/ for details on oe-node-red settings");

    // Flag to indicate whether PROJECTS are enabled of not
//    var projectsEnabled = settings.editorTheme && settings.editorTheme.projects && settings.editorTheme.projects.enabled === true;
    
    // If PROJECTS are not enabled, Setup oe-cloud specific storage module as storage module  
    if (!projectsEnabled) {
        settings.storageModule = require("../../lib/oe-node-red-storage");
        console.log(TAG + "Node-Red is in PRODUCTION Mode:");
        console.log(TAG + "    - Node-RED Flow PROJECTS are DISABLED");
        console.log(TAG + "    - 'oe-node-red-storage' (DB storage for NR Flows) is ENABLED");
    } else {
        console.log(TAG + "Node-Red is in DEVELOPMENT Mode:");
        console.log(TAG + "    - Node-RED Flow PROJECTS are ENABLED");
        console.log(TAG + "    - 'oe-node-red-storage' (DB storage for NR Flows) is DISABLED");
    }
    if (server.get('enableNodeRedAdminRole') === true) console.log(TAG + "Node-RED Admin Role is ENABLED. Only users with nodeRedAdminRoles (see server/config.json) can use Node-RED");
    else console.log(TAG + "Node-RED Admin Role is DISABLED (default). Any logged-in user can use Node-RED");
    console.log(TAG + "Node-RED Starting at http://<this_host>:" + settings.uiPort + settings.httpAdminRoot);
    console.log('\n===================================================================\n');

    settings.editorTheme.projects.appPort = server.get('port'); // application Port is required in Node-RED UI, so adding to settings.
    return settings;                                            // Only Projects settings seem to be passed to UI, so...
}


// Function to check if the current request came from a logged-in user
// who has a node-red admin role. Node-RED admins can be specified
// in config.json using the 'nodeRedAdminRoles' array property.
// If this property is absent, but node-red admin is still enabled,
// then a default role called NODE_RED_ADMIN is used.
function isNodeRedAdmin(req, nodeRedAdminRoles) {
    if (!nodeRedAdminRoles || !nodeRedAdminRoles.length) {
        console.warn(TAG + 'nodeRedAdminRoles is invalid. Should be a string array.');
        return false;
    }
    var result = false;
    if (req.accessToken) {
        var instance = req.accessToken.__data;
        if (instance && instance.roles) {
            for(var i=0; i<nodeRedAdminRoles.length; i++) {
                result = instance.roles.includes(nodeRedAdminRoles[i]);
                if (result) break;
            };
        }
    } 
    return result;
}



// Log levels
var levelNames = {
    10: 'fatal',
    20: 'error',
    30: 'warn',
    40: 'info',
    50: 'debug',
    60: 'trace',
    98: 'audit',
    99: 'metric'
};

// returns the logger object
function initLogger(settings) {
    return logger;
}

// Logs message as per log level
function logger(msg) {
    var level = levelNames[msg.level];
    delete msg.level;
    delete msg.timestamp;
    switch (level) {
        case 'metric':
            _log.trace(_log.defaultContext(), msg);
            break;
        case 'audit':
            _log.trace(_log.defaultContext(), msg);
            break;
        case 'trace':
            _log.trace(_log.defaultContext(), msg);
            break;
        case 'debug':
            _log.debug(_log.defaultContext(), msg);
            break;
        case 'info':
            _log.info(_log.defaultContext(), msg);
            break;
        case 'warn':
            _log.warn(_log.defaultContext(), msg);
            break;
        case 'error':
            _log.error(_log.defaultContext(), msg);
            break;
        case 'fatal':
            _log.fatal(_log.defaultContext(), msg);
            break;
        default:
            break;
    }
}

