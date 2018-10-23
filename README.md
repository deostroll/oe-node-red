# oe-node-red module for oe-cloud based applications

### What's new:
<pre>

1. Removed the concept of environment variable (NODE_ENV) deciding whether flows are saved to database or not. 
   Now flows are always saved to the database
2. In parallel to the DB persistence, a node-red-flows.json file is also created in $PROJECT_DIR/nodered/ folder
3. This node-red-flows.json file can be committed to source-control
4. It can also be directly used for initial data seeding in production as the data format of this file is the same 
   as that of the NodeRedFlow table.
5. Node-Red can now be accessed on the same port as the application. There's no need to set the uiPort in Node-Red settings.
6. The optional Node-Red Settings file at $PROJECT_DIR/server/node-red-settings.js overrides defaults provided in code
   on a per-parameter basis. So you can provide partial settings in node-red-settings.js

</pre>

## Introduction
**Node-RED** has been a feature of *oe-cloud* framework for some time now, and it has been widely adopted for its extreme ease of use. 
In order to take advantage of new features introduced in newer versions of *Node-RED*, we need to be able to upgrade *Node-RED* easily and seamlessly.
To this end, *Node-RED* has been separated from the core *oe-cloud* framework and the *Node-RED* integration is now implemented as an 
optional "app-list" module for the *oe-cloud*-based app. This new module is called **oe-node-red**.

## About the module
**oe-node-red** is a nodejs module for *Node-RED* integration with *oe-Cloud*, and this module is the only dependency required by an
*oe-Cloud* based application to get the *Node-RED* feature.

This module adds a *loopback* boot-script for starting *Node-RED* as part of the *loopback* app boot-up. It also adds a few loopback models to the app for managing Node-RED data.

The *oe-node-red* module also manages other dependencies like [**loopback-connector-nodes-for-Node-RED**](http://evgit/oecloud.io/loopback-connector-nodes-for-Node-RED), and *Node-RED* itself. 
As of now, the *Node-RED* dependency version is changed from 16.x to 18.x, which has various improvements over its predecessors.

**Note**:

Unlike previous iterations of *Node-RED* integration in oe-Cloud, now *Node-RED* flows are saved to database irrespective of whether the app is in production mode
or not. Flows are also saved to `{userDir}/{flowFile}` in parallel. This is to enable source-control of flow data, as well as to aid initial data seeding
in production.


## How to add Node-RED feature in oe-cloud -based app?

To get the *Node-RED* feature in the application, the **oe-node-red** node module needs to be added 
as a *package.json* dependency in the application. 

Also, the module needs be added to the `server/app-list.json` file in the app. 

For e.g.,

<pre>
package.json  (only part of the file is shown here, with relevant section in bold):


   ...
   ...
   "dependencies": {
       ...
       ...
       ...
       <b>"oe-node-red": "git+http://evgit/oecloud.io/oe-node-red.git#master",</b>
       ...
       ...

</pre>

<pre>
server/app-list.json   (Relevant section in bold):

[
    {
        "path": "oe-cloud",
        "enabled": true
    },
    <b>{
        "path": "oe-node-red",
        "enabled": true
    },</b>
	. . .
	. . .
]
</pre>


### Configuration

The *oe-node-red* module is configured from two files - 

* server/config.json
* server/node-red-settings.js

#### server/config.json settings

The *oe-node-red* configuration settings in `config.json` are used for high level control, like enabling/disabling *Node-RED*, 
enabling and setting up Node-RED-admin roles, etc., 

All *oe-node-red* configuration parameters in this file are optional. 

The following are the *oe-node-red* configuration settings possible in the application's `server/config.json` file:
<pre>
-------------------------------------------------------------------------------------------------------------------
setting                  type           default (if not defined)  Description          
-------------------------------------------------------------------------------------------------------------------
disableNodered           boolean        false                     Use this to turn off Node-RED (despite having the *oe-node-red* module)
                                                                  by setting this parameter to true. Default is false, i.e., Node-RED is
                                                                  enabled by default. See notes below for corresponding environment variable.
                                                                  
enableNodeRedAdminRole   boolean        false                     Use this to allow only users having certain roles to access the Node-RED UI
                                                                  by setting this parameter to true. Default is false, which allows all users
                                                                  access to Node-RED UI.
                                                                  
nodeRedAdminRoles        string array   ["NODE_RED_ADMIN"]        Use this to setup the names of the roles which have access to the Node-RED UI. 
                                                                  This setting is used only if enableNodeRedAdminRole is true.
                                                                  
-------------------------------------------------------------------------------------------------------------------                                                                  
</pre>


#### server/node-red-settings.js

`server/node-red-settings.js` supports the same parameter settings as *Node-RED's* [`settings.js` file](https://nodered.org/docs/configuration). 

*If this file is present, parameters from this file are merged and prioritized over the sane default values mentioned below and the result is taken as Node-RED configuration*

**Thus, this file can be used to override the Node-RED configuration defaults provided in code**


Some of the important settings possible in this file are documented here: https://nodered.org/docs/configuration

A sample `server/node-red-settings.js` file is provided below:

```javascript
module.exports = {                                  // All defaults mentioned below are applicable only   
                                                    // if this file (server/node-red-settings.js) is **not present**
                                             
  httpRequestTimeout: 120000,                       // default: not set
  httpAdminRoot: '/red',                            // default: /red
  httpNodeRoot: '/redapi',                          // default: /redapi
  userDir: 'nodered/',                              // default: nodered/
  nodesDir: '../nodes',                             // default: ../nodes
  flowFile: 'node-red-flows.json',                  // default: 'node-red-flows.json'
  flowFilePretty: true,                             // default: true
  functionGlobalContext: {                          // default: {
    loopback: require('loopback'),                  //            loopback: require('loopback'),
    logger: require('oe-logger')('node-red-flow')   //            logger: require('oe-logger')('node-red-flow')
  }                                                 //          }
}

```

This file (`server/node-red-settings.js`) is optional. In its absence, sane defaults as mentioned above are provided by the *oe-node-red* module. 



#### Notes

As mentioned above, *Node-RED* integration can be disabled from the `server/config.json`. It can also be disabled by 
setting the environment variable:
```console
DISABLE_NODE_RED=true   (or 1)
```

If `server/node-red-settings.js` is not present, the defaults that are provided are as in the comments above.

As noted earlier, *Node-Red* flows are saved to database whether the app is in production mode or not. A flow data file is also
persisted to `{userDir}/{flowFile}`. If **production** mode is enabled by setting the environment variable `NODE_ENV` to `production`, 
then the flows won't be persisted to file. Thus, flows would only be saved to database in production.

During development, the flow data file persisted at `{userDir}/{flowFile}` contains data in the same format as the database table
holding flows (`NodeRedFlow` table). So this file can be used directly for initial seeding of data in production.


## Migration from oe-cloud v 1.2.0/1.3.0/1.4.0
In this new implementation of *Node-RED* integration, flow-nodes are now stored as separate records, one record per node.
A record of a node looks like this:

```json
{ 
    "id"   :    "7b279bd6.7b9064", 
    "node" :    { 
                    "id" : "7b279bd6.7b9064", 
                    "type" : "mqtt in", 
                    "z" : "8a31d1.1fd8ce3", 
                    "name" : "", 
                    "topic" : "testtopic", 
                    "qos" : "2", 
                    "broker" : "5e5886e3.30a7d8", 
                    "x" : 190, 
                    "y" : 160, 
                    "wires" : [ [ ] ] 
                } 
}
```
So, a flow that contains 10 nodes would be stored as 10 records plus an extra node of type "tab", making a total of 11 records
in the database (Any configuration nodes will add more nodes). This is in contrast to the earlier (*oe-cloud v 1.2.0/1.3.0/1.4.0*) implementation
where all flows (and their nodes) were stored as a single record in the database. The old storage format will not work with
the new *Node-RED* integration implementation.

To address this, the following migration strategy can be adopted:

1. Before upgrading to the new *oe-Cloud* that includes the new *Node-RED* integration implementation, Login to your application with the old *Node-RED* implementation and open the *Node-RED* UI.
2. Select a tab, Do "Select All" using "Ctrl+A", and export the current tab's flows to the clipboard using the ``Menu --> Export --> Clipboard`` option.
3. Save the contents of the clipboard to a local file, using a filename which is the same as the tab name.
4. Repeat steps 2 and 3 for all tabs in your *Node-RED* interface, at the end of which you should have as many local files as there are tabs in your *Node-RED* UI.
5. Delete all your *Node-RED* flow-data from the **NodeRedFlow** table in the application database.
6. Upgrade to the latest version of oe-cloud which includes the new implementation of *Node-RED* integration (Follow instructions from **How to add Node-RED feature in oe-cloud -based app?** section above).
7. Login to your application and open the new *Node-RED* UI
8. Import the flows from each of the files created in step 3 back into *Node-RED*, naming the tabs the same as the filename, using the ``Menu --> Import --> Clipboard`` option
9. Run a sanity test on your flows.
10. Optional: At the end of the import, you should have a `{userDir}/{flowFile}` file containing all flow data as an array of nodes. Use this file to commit to source-control and for initial data seeding in production environment.





