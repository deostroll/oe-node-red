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

