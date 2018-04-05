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
var options = {ignoreAutoScope: true, fetchAllScopes: true};


module.exports = function startNodeRed(server1, callback) {
    callback();

    var _createNode = RED.nodes.createNode;
    RED.nodes.createNode = function(thisnode, config) {
        thisnode.on('input', function(msg) {
            msg.callContext = config.callContext;
        });
        _createNode(thisnode, config);
    };

    // Create an Express app
    var app = express();

    var pre_auth = require('../../../oe-cloud/server/middleware/pre-auth-context-populator.js');
    app.use(pre_auth({}));

    var AuthSession = loopback.getModelByType('AuthSession');
    app.use(loopback.token({
        model: AuthSession,
        currentUserLiteral: 'me'
    }));

    var post_auth = require('../../../oe-cloud/server/middleware/post-auth-context-populator.js');
    app.use(post_auth());

    // parse application/x-www-form-urlencoded
    app.use(bodyParser.urlencoded({
        extended: false
    }));

    // parse application/json
    app.use(bodyParser.json());

    // Create the settings object - see default settings.js file for other options
    var settings = getSettings(server1);
    if (!settings) return;

    var projectsEnabled = settings.editorTheme && settings.editorTheme.projects && settings.editorTheme.projects.enabled === true;

    if(!projectsEnabled) 
    {
        NodeRedFlows.observe('after save', function flowModelAfterSave(ctx, next) {
            next();
            messaging.publish('reloadNodeRedFlows', uuidv4());
        });

        messaging.subscribe('reloadNodeRedFlows', function reloadNodeRedFlowsFn(version) {
            RED.nodes.loadFlows();
        });

        app.use(function (req, res, next) {
            if (req.url.startsWith("/red/flows")) {
                if (req.method === "POST") {
                    NodeRedFlows.find({}, options, function findCb(err, results) {
                        if(err) console.log(err);
                        if(!results) results = [];
                        var newids = req.body.flows.map(function(f) {
                            return f.id;
                        });

                        var res = [];
                        results.forEach(function(f) {
                            if(newids.indexOf(f.id) < 0) res.push(f.__data);
                        });
                        req.body.flows.forEach(function (f) {
                            if (!f.callContext) f.callContext = req.callContext;
                            res.push(f);
                        });
                        req.body.flows = res;
                        next();
                    });


                } else if (req.method === "GET") {
                    var result_flows = [];
                    var send = res.send;
                    res.send = function (string) {
                        var body = string instanceof Buffer ? string.toString() : string;
                        if (!body) body = "{}";
                        var json = JSON.parse(body);
                        var rev;
                        if (json && json.flows) {
                            rev = json.rev;
                            json.flows.forEach(function (f) {
                                if (f.callContext.ctx.remoteUser === req.callContext.ctx.remoteUser)
                                    result_flows.push(f);
                            });
                        } else {
                            console.log("No flows in response, json=", json);
                        }
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
    }
    else 
    {
        app.use(function (req, res, next) {
            if (req.url.startsWith("/red/flows")) {
                if (req.method === "POST") {
                    if(req.body && req.body.flows)
                        req.body.flows.forEach(function (f) {
                            if (!f.callContext) f.callContext = req.callContext;
                        });
                    next();
                } else next();
            } else next();
        });
    }

    // Create a server
    var server = http.createServer(app);

    // Initialise the runtime with a server and settings
    RED.init(server, settings);

    // Serve the editor UI from /red
    app.use(settings.httpAdminRoot, RED.httpAdmin);

    // Serve the http nodes UI from /api
    app.use(settings.httpNodeRoot, RED.httpNode);

    var nodeRedPort = settings.uiPort;
    var port = nodeRedPort ? nodeRedPort : 3001;
    server.listen(port);

    // Start the runtime
    RED.start();
    console.log("Node-RED Starting on port " + port)
}


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

        // Object.keys(fileSettings).forEach(function(k) {
        //     settings[k] = fileSettings[k];
        // });
    } catch(e) {
        console.log('server/node-red-settings.js Not Found');
    }

    if(!fileSettings) {
        var nodeRedUserDir = server.get('nodeRedUserDir');
        if (!nodeRedUserDir) {
            nodeRedUserDir = 'nodered/';
        }
        var nodeRedMetrics = server.get('nodeRedMetrics') || false;
        var nodeRedAudit = server.get('nodeRedAudit') || false;
        var projectsEnabled = (process.env["ENABLE_NODE_RED_PROJECTS"] === "true" ||
            process.env["ENABLE_NODE_RED_PROJECTS"] === "1") ? true : false;
        console.log("Node-RED flow Projects are ", projectsEnabled ? "ENABLED" : "DISABLED", "( env variable ENABLE_NODE_RED_PROJECTS =", process.env["ENABLE_NODE_RED_PROJECTS"], projectsEnabled ? "" : " Set this to 'true' or '1' to enable NR Projects", " )");

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
            // enables global context
        };
    } else {
        settings = fileSettings;
    }
    var projectsEnabled = settings.editorTheme && settings.editorTheme.projects && settings.editorTheme.projects.enabled === true;
    if (!projectsEnabled) {
        settings.storageModule = require("../../lib/oe-node-red-storage");
        console.log("Enabling oe-node-red-storage as PROJECTS are DISABLED");
    } else {
        console.log("DISABLING oe-node-red-storage as PROJECTS are ENABLED");
    }
        

    return settings;
}




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


function initLogger(settings) {
    return logger;
}

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