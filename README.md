# oe-node-red module for oe-cloud based applications

## Introduction
**Node-RED** has been a feature of *oe-cloud* framework for some time now, and it has been widely adopted for its extreme ease of use. 
In order to take advantage of new features introduced in newer versions of Node-RED, like PROJECTS (linking Node-RED flows with Git), 
we need to be able to upgrade Node-RED easily and seamlessly.
To this end, Node-RED has been separated from the core *oe-cloud* and it is now an optional module and "app-list" app for *oe-cloud* based apps.

## About the module
**oe-node-red** is a meta-package for Node-RED integration with *oe-cloud*, which means that this module is the only dependency required by an
*oe-cloud* based application to get the Node-RED integration feature. *oe-node-red* module manages other dependencies like *loopback-connector-for-Node-RED*,
and *Node-RED* itself.

### Usage
To get the *Node-RED* feature in the application, the **oe-node-red** node module needs to be added as a *package.json* dependency in the application. 
Also, the module needs be added to the `server/app-list.json` file in the app. For e.g.,


<pre>
server/app-list.json:

[
    {
        "path": "oe-cloud",
        "enabled": true
    },
    <b>{
        "path": "oe-node-red",
        "enabled": true
    },</b>
	{
		"path" : "oe-workflow",
		"enabled" : true
	},
	{
        "path": "./",
        "enabled": true
    }
]
</pre>


### About the new `projects` feature

`projects` are meant to be enabled in development environment only. In production, you'd typically 
disable projects. While in `projects` mode (development), flows that are created using the UI are 
saved locally, in the filesystem, and you have the option of connecting all flows to a single Git 
repository through the Node-RED UI. Standard Git features such as check in, check out, commit,
history, etc., are available via the Node-RED UI.
See here for more info: https://nodered.org/docs/user-guide/projects/


### Configuration

The *oe-node-red* module is configured mainly from two places - 

* server/config.json
* server/node-red-settings.js

The *oe-node-red* configuration settings are `config.json` is used for high level control, like enabling/disabling Node-RED, 
enabling and setting up Node-RED-admin roles, etc., All *oe-node-red* configuration parameters in this file are optional. 

The configuration settings possible in `node-red-settings.js` are the same as those that are available to a standalone Node-RED
instance through its `settings.js` configuration file. Thus, `server/node-red-settings.js` supports the same parameter settings
as Node-RED's `settings.js` file. This file (`server/node-red-settings.js`) is optional. In its absence, sane defaults are provided 
by the *oe-node-red* module. 
*However, if this file is present, all Node-RED configuration is taken from this file and no defaults will be provided, except for the storage module.*

#### server/config.json settings

The following are the *oe-node-red* configuration settings possible in the application's `server/config.json` file:
<pre>
-------------------------------------------------------------------------------------------------------------------
setting                  type           default (if not defined)  Description          
-------------------------------------------------------------------------------------------------------------------
disableNodered           boolean        false                     Use this to turn off Node-RED (despite having the *oe-node-red* module)
                                                                  by setting this parameter to true.
                                                                  
enableNodeRedAdminRole   boolean        false                     Use this to allow only users having certain roles to access the Node-RED UI
                                                                  by setting this parameter to true. Default is to allow all users access.
                                                                  
nodeRedAdminRoles        string array   ["NODE_RED_ADMIN"]        Use this to setup which roles have access to the Node-RED UI. Applicable 
                                                                  only if enableNodeRedAdminRole is true.
                                                                  
nodeRedUserScope         boolean        false                     Use this to configure the basis for Node-RED flow isolation (for access).
                                                                  Setting this to true causes the flows to be isolated based on user. So user A
                                                                  can see and edit only flows created by him, but cannot access user B's flows.
                                                                  Setting this to false (the default) causes flows to be isolated based on tenant.
-------------------------------------------------------------------------------------------------------------------                                                                  
</pre>


#### server/node-red-settings.js

As mentioned above, this file would contain the same settings as the standalone Node-RED `settings.js` file. 
Some of the important settings possible in this file is documented here: https://nodered.org/docs/configuration

A sample `server/node-red-settings.js` file is provided below:

```javascript
module.exports = {
  uiPort: process.env.NODE_RED_PORT || 3001,        // default: 3001
  httpRequestTimeout: 120000,                       // default: not set
  editorTheme: {       
    projects: {
      enabled: false                                // default: false
    }
  },
  projectsDir: "D:/NR",                             // default: nodered/projects
  httpAdminRoot: '/red',                            // default: /red
  httpNodeRoot: '/redapi',                          // default: /red
  userDir: 'nodered/',                              // default: nodered/
  nodesDir: '../nodes',                             // default: ../nodes
  flowFile: 'node-red-flows.json',                  // default: 'node-red-flows.json'
  flowFilePretty: true,                             // default: true
  credentialSecret: "my-random-string",             // default: "my-random-string"
  functionGlobalContext: {                          // default: {
    loopback: require('loopback'),                  //            loopback: require('loopback'),
    logger: require('oe-logger')('node-red-flow')   //            logger: require('oe-logger')('node-red-flow')
  }                                                //          }
}

```

#### Notes

If `server/node-red-settings.js` is not present, the defaults that are provided are as in the comments above.

If `server/node-red-settings.js` is not present, `projects` can be enabled using an environment variable:
```console
ENABLE_NODE_RED_PROJECTS=true   (or 1)
```


If `projects` are disabled, then Node-RED's storage module is set to the *oe-cloud* specific database 
storage module (`'../../lib/oe-node-red-storage'`). 
If `projects` are enabled, then Node-RED uses its default filesystem storage. 


Finally, if `server/node-red-settings.js` is not present, and you wish to change the defaults on a 
per-parameter basis, then the following `server/config.json` optional parameters are available:

<pre>
-------------------------------------------------------------------------------------------------------------------
setting                  type       Description          
-------------------------------------------------------------------------------------------------------------------
nodeRedUserDir           string     Same as 'userDir' of node-red-settings.js
                                    

projectsEnabled          boolean    If set to true, enables projects and disables oe-node-red-storage module
                                    If set to false, disables projects and enables oe-node-red-storage module

flowProjectsDir          string     Sets the location where Node-RED stores the flow Git projects. Applicable
                                    when projectsEnabled is set to true.

-------------------------------------------------------------------------------------------------------------------                                                                  
</pre>



