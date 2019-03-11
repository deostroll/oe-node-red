var oecloud = require('oe-cloud');
const loopback = require('loopback');
// var loopback=require('loopback');
// oecloud.attachMixinsToBaseEntity("SkeletonMixin");


oecloud.observe('loaded', function (ctx, next) {
  oecloud.attachMixinsToBaseEntity('MultiTenancyMixin');
  oecloud.setBaseEntityAutoscope(['tenantId']);
  return next();
});
oecloud.addContextField('tenantId', {
  type: 'string'
});

oecloud.observe('loaded', function (ctx, next) {
  return next();
});

function deleteAllUsers(done) {
  var userModel = loopback.findModel('User');
  userModel.destroyAll({}, {}, function (err) {
    return done(err);
  });
}

oecloud.boot(__dirname, function (err) {
  if (err) {
    console.log(err);
    process.exit(1);
  }
  var accessToken = loopback.findModel('AccessToken');
  accessToken.observe('before save', function (ctx, next) {
    var userModel = loopback.findModel('User');
    var instance = ctx.instance;
    userModel.find({ where: { id: instance.userId } }, {}, function (err, result) {
      if (err) {
        return next(err);
      }
      if (result.length != 1) {
        return next(new Error('No User Found'));
      }
      var user = result[0];
      instance.ctx = instance.ctx || {};
      if (user.username === 'admin') {
        instance.ctx.tenantId = '/default';
      } else if (user.username === 'iciciuser') {
        instance.ctx.tenantId = '/default/iciciuser';
      } else if (user.username === 'citiuser') {
        instance.ctx.tenantId = '/default/citi';
      }
      return next(err);
    });
  });
  oecloud.start();
  oecloud.emit('test-start');

  var defaults = require('superagent-defaults');
  var supertest = require('supertest');
  var api = defaults(supertest(oecloud));
  var basePath = oecloud.get('restApiRoot');

  deleteAllUsers(function (err) {
    var url = basePath + '/users';
    api.set('Accept', 'application/json')
      .post(url)
      .send([{ username: 'admin', password: 'admin', email: 'admin@admin.com' },
        { username: 'iciciuser', password: 'iciciuser', email: 'iciciuser@iciciuser.com' },
        { username: 'citiuser', password: 'citiuser', email: 'citiuser@citiuser.com' }
      ])
      .end(function (err, response) {
        var result = response.body;
      });
  });
});

/*
oecloud.boot(__dirname, function (err) {
  var m = loopback.findModel("Model");
  m.setOptions = function(){
    return { ctx : { tenantId : '/anonymous'}};
  }
  var accessToken = loopback.findModel('AccessToken');
  accessToken.observe("before save", function (ctx, next) {
    var userModel = loopback.findModel("User");
    var instance = ctx.instance;
    userModel.find({ where: {id: instance.userId} }, {}, function (err, result) {
      if (err) {
        return next(err);
      }
      if (result.length != 1) {
        return next(new Error("No User Found"));
      }
      var user = result[0];
      if (user.username === "admin") {
        instance.tenantId = '/default';
      }
      else if (user.username === "evuser") {
        instance.tenantId = '/default/infosys/ev';
      }
      else if (user.username === "infyuser") {
        instance.tenantId = '/default/infosys';
      }
      else if (user.username === "bpouser") {
        instance.tenantId = '/default/infosys/bpo';
      }
      return next(err);
    });
  });


  oecloud.start();
  oecloud.emit('test-start');
});
*/
