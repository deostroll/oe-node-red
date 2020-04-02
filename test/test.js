/**
 *
 * ©2018-2019 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
/**
 *
 * This is a mocha test script for the oe-node-red app-list module for oe-Cloud
 * based applications.
 *
 * @file test.js
 * @author Ajith Vasudevan
 */
var app = require('oe-cloud');
var loopback = require('loopback');
var log = require('oe-logger')('jobSchedulerTest');
var chalk = require('chalk');
var chai = require('chai');
var async = require('async');
chai.use(require('chai-things'));
var expect = chai.expect;
var defaults = require('superagent-defaults');
var supertest = require('supertest');
var api = defaults(supertest(app));
var RED = require('node-red');

// Boot the application instance
app.boot(__dirname, function (err) {
  if (err) {
    console.log(chalk.red(err));
    log.error(err);
    process.exit(1);
  }
  app.start();
  app.emit('test-start');
});

var basePath;

// Test case code begins here:
describe(chalk.blue('oe-node-red-test'), function (done) {
  var TAG = 'describe()';
  log.debug(TAG, 'Starting oe-job-scheduler-test');

  this.timeout(600000); // setting the timeout to 10 minutes so as to be able to keep running
  // the application for as long as required to do all  tests


  before('wait for boot scripts to complete', function (done) {
    var TAG = 'before()';
    log.debug('Starting ' + TAG);
    basePath = app.get('restApiRoot');
    done();
  });


  // This Mocha function is called after all 'it()' tests are run
  // We do some cleanup here
  after('after all', function (done) {
    var TAG = 'after()';
    console.log(chalk.yellow('Starting ' + TAG));
    log.debug(TAG, 'After all tests');
    done();
    setTimeout(function () {
      process.exit(0);
    }, 1000);
  });


  var testName1 = 'should test if node-red flows started successfully';
  it(testName1, function (done) {
    var TAG = '[ it ' + testName1 + ' ]';
    console.log(chalk.yellow('[' + new Date().toISOString() + ']      : ', 'Starting ' + TAG));
    var redEvents = RED.events;
    redEvents.once('nodes-started', function () {
      console.log('Received RED event: nodes-started');
      done();
    });
  });


  testName2 = 'should test if node-red flows are saved to DB upon posting';
  it(testName2, function (done) {
    var TAG = '[ it ' + testName2 + ' ]';
    console.log(chalk.yellow('[' + new Date().toISOString() + ']      : ', 'Starting ' + TAG));
    var postUrl = '/red/flows'; // API to post flows
    api.set('Content-Type', 'application/json')
      .set('Node-RED-API-Version', 'v2')
      .post(postUrl)
      .send({'flows': [
        { 'id': '39ebf3b6.df87ec', 'type': 'tab', 'label': 'testFlow', 'disabled': false, 'info': '' },
        { 'id': '8b34445e.21f748', 'type': 'inject', 'z': '39ebf3b6.df87ec', 'name': 'testinject', 'topic': '', 'payload': '', 'payloadType': 'date', 'repeat': '1', 'crontab': '', 'once': false, 'onceDelay': 0.1, 'x': 180, 'y': 100, 'wires': [ [ '22954204.69cdde' ] ] },
        { 'id': '22954204.69cdde', 'type': 'debug', 'z': '39ebf3b6.df87ec', 'name': 'testdebug', 'active': true, 'tosidebar': true, 'console': false, 'tostatus': false, 'complete': 'payload', 'x': 410, 'y': 100, 'wires': [ ] },
        {'id': '8a31d1.1fd8ce3', 'type': 'tab', 'label': 'Flow 1', 'disabled': false, 'info': ''},
        {'id': '5e5886e3.30a7d8', 'type': 'mqtt-broker', 'z': '', 'name': '', 'broker': 'localhost', 'port': '1883', 'clientid': '', 'usetls': false, 'compatmode': true, 'keepalive': '60', 'cleansession': true, 'willTopic': '', 'willQos': '0', 'willPayload': '', 'birthTopic': '', 'birthQos': '0', 'birthPayload': '', 'credentials': {'user': 'ajith', 'password': 'ajith'}}
      ]}) // payload for posting flows
      .end(function (err, response) {
        expect(err).not.to.be.defined; // Expect no error upon calling API
        expect(response.statusCode).to.equal(200); // Expect 200 OK response
        done();
      });
  });


  testName3 = 'should test if node-red flows are fetched from DB upon getting';
  it(testName3, function (done) {
    var TAG = '[ it ' + testName3 + ' ]';
    console.log(chalk.yellow('[' + new Date().toISOString() + ']      : ', 'Starting ' + TAG));


    var postUrl = '/red/flows'; // API to post flows
    api.set('Content-Type', 'application/json')
      .set('Node-RED-API-Version', 'v2')
      .post(postUrl)
      .send({'flows': [{'id': '7b279bd6.7b9064', 'type': 'mqtt in', 'z': '8a31d1.1fd8ce3', 'name': '', 'topic': 'testtopic', 'qos': '2', 'broker': '5e5886e3.30a7d8', 'x': 190, 'y': 160, 'wires': [[]]}]}) // payload for posting a flow
      .end(function (err, response) {
        expect(err).not.to.be.defined; // Expect no error upon calling API
        expect(response.statusCode).to.equal(200); // Expect 200 OK response
        var getUrl = '/red/flows'; // API to get flows
        api.get(getUrl)
          .end(function (err, response) {
            expect(err).not.to.be.defined; // Expect no error upon calling API
            expect(response.statusCode).to.equal(200); // Expect 200 OK response
            done();
          });
      });
  });

  testName4 = 'should test if node-red flows libraries are disabled while posting';
  it(testName4, function (done) {
    var TAG = '[ it ' + testName4 + ' ]';
    console.log(chalk.yellow('[' + new Date().toISOString() + ']      : ', 'Starting ' + TAG));
    var postUrl = '/red/library/local/flows/test'; // API to post flow library
    api.set('Content-Type', 'application/json')
      .set('Node-RED-API-Version', 'v2')
      .post(postUrl)
      .send([]) // payload for posting flows
      .end(function (err, response) {
        expect(err).not.to.be.defined; // Expect no error upon calling API
        expect(response.statusCode).to.equal(400); // Expect 400 error response
        expect(response.body.message).to.equal('Error'); // Expect correct error message
        done();
      });
  });


  testName5 = 'should test if node-red flows libraries are disabled while getting';
  it(testName5, function (done) {
    var TAG = '[ it ' + testName5 + ' ]';
    console.log(chalk.yellow('[' + new Date().toISOString() + ']      : ', 'Starting ' + TAG));
    var getUrl = '/red/library/local/flows'; // API to get flow library
    api.set('Content-Type', 'application/json')
      .set('Node-RED-API-Version', 'v2')
      .get(getUrl)
      .end(function (err, response) {
        expect(err).not.to.be.defined; // Expect no error upon calling API
        expect(response.statusCode).to.equal(200); // Expect 500 error response
        expect(response.body).to.be.empty; // Expect empty object
        done();
      });
  });
});
