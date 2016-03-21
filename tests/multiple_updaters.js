// test some timeouts


var SmartCache = require('../index.js');

var cache = new SmartCache({
	debug_mode: true
});

var double = function(num) {
	return num*2;
}

var VALS = [];


var testUpdater = new cache.Updater(function(val,data,key,cache){
	// this - refers to the Updater
	var self = this;
	return new Promise(function(resolve,reject){
		setTimeout(function(){
			console.log("In [testUpdater (" + self.id() + ":" + self._ref + ")].callback - key",key);
			if(val !== undefined) {
				console.log("got a 'set' command");
				cache.set('key2',val); cache.set('key3',val)
				resolve(val);
				return;
			} else {
				console.log("[testUpdater] was a 'selfUpdate' ")
				if(data !== undefined) {
					console.log("  + has data");
					cache.set('key2',data); 
					cache.set('key3',data+1)
					resolve(double(data));
				} else {
					console.log("  - no data");
					cache.set('key2',5); cache.set('key3',5)
					resolve(5);
				}
			}
		},1000);
	});
},function(val,key,cache){
	console.log("On delete key:",key,"last val was:",val);
},
function(){
	console.trace("[testUpdater] OnShutdown");
},
{
	interval: 5000,
	id: 'testUpdater'
});




var dogUpdater = new cache.Updater(function(val,data,key,cache){
	// this - refers to the Updater
	var self = this;
	return new Promise(function(resolve,reject){
		setTimeout(function(){
			console.log("In [dogUpdater (" + self.id() + ":" + self._ref + ")].callback - DOG",key);
			if(val !== undefined) {
				console.log("got a 'set' command");
				cache.set('DOG2',val); cache.set('DOG3',val)
				resolve(val);
				return;
			} else {
				console.log("[dogUpdater] was a 'selfUpdate' ")
				if(data !== undefined) {
					console.log("  + has data");
					cache.set('DOG2','doggy1'); 
					cache.set('DOG3','doggy2')
					resolve('doggy-again');
				} else {
					console.log("  - no data");
					cache.set('DOG2','doggy1'); cache.set('DOG3','doggy1')
					resolve('doggy1');
				}
			}
		},1000);
	});
},function(val,key,cache){
	console.log("On delete key:",key,"last val was:",val);
},
function(){
	console.trace("[dogUpdater] OnShutdown");
},
{
	interval: 5000,
	id: 'dogUpdater'
});





cache.setData('DOG1',3,{
	updater: dogUpdater
	,ttl: 2000
});
cache.setData('DOG2',3,{
	updater: dogUpdater
	,ttl: 2000
});
cache.setData('DOG3',3,{
	updater: dogUpdater
	,ttl: 2000
});
cache.setData('DOG4',3,{
	updater: dogUpdater
	,ttl: 2000
});




cache.setData('key1',3,{
	updater: testUpdater
	,ttl: 2000
});

// and a bunch more keys TTL expires at the same time
cache.setData('key1.1',3,{
	updater: testUpdater
	,ttl: 2000
});
cache.setData('key1.2',3,{
	updater: testUpdater
	,ttl: 2000
});
cache.setData('key1.3',3,{
	updater: testUpdater
	,ttl: 2000
});
cache.setData('key1.4',3,{
	updater: testUpdater
	,ttl: 2000
});



cache.setData('key2',3,{
	updater: testUpdater
});

cache.setData('key3',3,{
	updater: testUpdater
});

// setTimeout(function(){
// 	cache.setData('key1',6);	
// },4000);

// setTimeout(function(){
// 	cache.setData('key1',7);	
// },6000);


var printInterval = setInterval(function(){
	console.log("--------------------------");
	var d = cache.getData('key1');
	console.log("key1:",d);
	var d = cache.getData('key1.1');
	console.log("key1.1:",d);
	var d = cache.getData('key1.2');
	console.log("key1.2:",d);
	var d = cache.getData('key1.3');
	console.log("key1.3:",d);
	var d = cache.getData('key1.4');
	console.log("key1.4:",d);

	var d = cache.getData('DOG1');
	console.log("DOG1:",d);
	var d = cache.getData('DOG2');
	console.log("DOG2:",d);
	var d = cache.getData('DOG3');
	console.log("DOG3:",d);
	var d = cache.getData('DOG4');
	console.log("DOG4:",d);



	var d = cache.getData('key2');
	console.log("key2:",d);
	var d = cache.getData('key3');
	console.log("key3:",d);
	console.log("Stats:",cache.getStats());
},1000);



setTimeout(function(){
	console.log("**** removed key1");
	cache.removeData('key1');
},10000);


setTimeout(function(){
	clearInterval(printInterval);
	cache.removeData('key2');
	console.log("clearing all of cache.");
	cache.clear();
	console.log("ok - done.");
},30000);


