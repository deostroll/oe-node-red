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

    // Serve the editor UI from /red
    app.use(settings.httpAdminRoot, RED.httpAdmin);

    // Serve the http nodes UI from /api
    app.use(settings.httpNodeRoot, RED.httpNode);

    var nodeRedPort = settings.uiPort;
    var port = nodeRedPort ? nodeRedPort : 3001;
    server1.listen(port);

    // Start the runtime
    RED.start();
    console.log("Node-RED Starting on port " + port)

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
            // Apply admin check only for URLs beginning with "/red"
            if (req.url.startsWith("/red") &&  !isNodeRedAdmin(req, nodeRedAdminRoles)) {
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
            if (req.url.startsWith("/red/flows")) {
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

                        // Get all flows in DB other than the ones in the current flow list from req,
                        // into the res array
                        results.forEach(function (f) {
                            if (newids.indexOf(f.id) < 0) res.push(f.__data);
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
                        next();
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
                            console.log("No flows in response, json=", json);
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
            if (req.url.startsWith("/red/flows")) {
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

    if (server.get('disableNodered') === true) {
        console.log('\n===================================================================\n');
        console.log('INFO: Node-Red is disabled via config.json: (disableNodered: true)');
        console.log('\n===================================================================\n');

        return false;
    }
    var settings;
    var fileSettings;
    try {
        var fileSettings = require('../../../../server/node-red-settings.js');
    } catch (e) {
        console.log('server/node-red-settings.js Not Found');
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
        var projectsEnabled = (process.env["ENABLE_NODE_RED_PROJECTS"] === "true" ||
            process.env["ENABLE_NODE_RED_PROJECTS"] === "1") ? true : false;
        console.log("Node-RED flow Projects are ", projectsEnabled ? "ENABLED" : "DISABLED", "( env variable ENABLE_NODE_RED_PROJECTS =", process.env["ENABLE_NODE_RED_PROJECTS"], projectsEnabled ? "" : " Set this to 'true' or '1' to enable NR Projects", " )");

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
            userDir: nodeRedUserDir,
            nodesDir: '../nodes',
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
        settings = fileSettings;
    }

    // Flag to indicate whether PROJECTS are enabled of not
    var projectsEnabled = settings.editorTheme && settings.editorTheme.projects && settings.editorTheme.projects.enabled === true;
    
    // If PROJECTS are not enabled, Setup oe-cloud specific storage module as storage module  
    if (!projectsEnabled) {
        settings.storageModule = require("../../lib/oe-node-red-storage");
        console.log("Enabling oe-node-red-storage as PROJECTS are DISABLED");
    } else {
        console.log("DISABLING oe-node-red-storage as PROJECTS are ENABLED");
    }


    return settings;
}


// Function to check if the current request came from a logged-in user
// who has a node-red admin role. Node-RED admins can be specified
// in config.json using the 'nodeRedAdminRoles' array property.
// If this property is absent, but node-red admin is still enabled,
// then a default role called NODE_RED_ADMIN is used.
function isNodeRedAdmin(req, nodeRedAdminRoles) {
    if (!nodeRedAdminRoles || !nodeRedAdminRoles.length) {
        console.warn('nodeRedAdminRoles is invalid. Should be a string array.');
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

