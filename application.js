/*
 * multihop-dtn-broadcast
 * UDP based Multihop, Delay-Tollerant Ping Server
 *
 * @author Putu Wiramaswara Widya <wiramaswara11@mhs.if.its.ac.id>
 * @author Suliadi Marsetya <marsetya11@mhs.if.its.ac.id>
 */

var dgram = require('dgram');
var os = require('os');
var http = require('http');
var crypto = require('crypto');
var socketio = require('socket.io');
var express = require('express'); // Web server untuk akses aplikasi

var port = 25000;
var host = "255.255.255.255";    // Receive and send from/to everything


// IP INFORMATION
var myIP = []
var networkInterfaces = os.networkInterfaces();
var updateMyIP = function(callback) {
    myIP = [];
    for(netIf in networkInterfaces) {
        for(ip in networkInterfaces[netIf]) {
            if(networkInterfaces[netIf][ip].family == 'IPv4') {
                myIP.push(networkInterfaces[netIf][ip].address);
            }
        }
    }
    if (callback) callback();
}


// MESSAGE AND BUFFER MANAGEMENT

var messageBuffer = {};
var retrievedMessage = [];
var createMessage = function(content, source, destination, location, ttl, callback) {
    var message = {};

    // Generate random hash ID
    crypto.randomBytes(48, function(ex, buf) {
        var id = buf.toString('hex');
        message[id] = {};

        message[id].content = content;
        message[id].location = location;
        message[id].source = source;
        message[id].destination = destination;
        var timeout = new Date();
        timeout.setHours(timeout.getHours() + 1);
        message[id].timeout = timeout.getTime();
        message[id].timestamp = new Date().getTime();
        if(!ttl) {
            message[id].ttl = 5;
        } else {
            message[id].ttl = ttl;
        }

        //messageBuffer[id] = message[id];

        // Callback with Buffer
        callback(new Buffer(JSON.stringify(message)));
    });

}

var convertMessageToBuffer = function(message, callback) {
    callback(new Buffer(JSON.stringify(message)));
}

var readMessage = function(bufferMessage, callback) {
    // Read back the buffer
    var serializedMessage = bufferMessage.toString();
    callback(JSON.parse(serializedMessage));
}

var broadcastStorm = function(message, msgId, callback){
    var forwardMessage = {};
    forwardMessage[msgId] = message[msgId];
    convertMessageToBuffer(forwardMessage, function(bufferedMessage) {
        socket.setBroadcast(true);
        socket.send(bufferedMessage, 0, bufferedMessage.length, port, host, function(err, bytes) {
            console.log("Auto broadcast message with id " + msgId);
            callback();
        });
    });
}

// SOCKET EVENT
var socket = dgram.createSocket('udp4');
var address = null;

socket.on('listening', function() {
    address = socket.address();
    console.log("UDP Broadcast listening on " + address.address + ":" + address.port);
});

// EXPRESS WEB SERVER INITIALIZE
var app = express();
app.configure(function() {
    app.use(express.static(__dirname));
    //app.use(express.static(__dirname + '/public'));
    app.set('view engine', 'ejs');
});

var server = http.createServer(app);
var io = socketio.listen(server);
server.listen(3000);

app.get('/', function(req, res) {
    res.render('manage.ejs');
});

var ioSockGlobal = null;
io.sockets.on('connection', function(iosock) {
    ioSockGlobal = iosock;

    iosock.on('sendMessage', function(data, callback) {
        // Kirim pesan
        updateMyIP(function(){
            createMessage(data.content, myIP[1], data.destination, data.location, 5, function(bufferedMessage) {
                socket.setBroadcast(true);
                socket.send(bufferedMessage, 0, bufferedMessage.length, port, host, function(err, bytes) {
                    callback(err);
                });
            });
        });
    });

    iosock.on('retrieveAllMessage', function(data, callback) {
        callback(retrievedMessage);
    })

});

socket.on('message', function(message, remote) {
    updateMyIP(function() {
        // Get the message
        readMessage(message, function(result) {
            var newMessage = result;
            for(msgId in newMessage) {
                if(!messageBuffer[msgId]) {
                    // There is no such message in buffer
                    // Add to buffer
                    messageBuffer[msgId] = newMessage[msgId];

                    // Is this message intended for us?
                    for(ip in myIP) {
                        if(newMessage[msgId].destination == myIP[ip]) {
                            console.log("New message for us (id: " + msgId + "): " + newMessage[msgId].content);
                            retrievedMessage.push(newMessage[msgId]);
                            if(ioSockGlobal) {
                                ioSockGlobal.emit('retrieveMessage', newMessage[msgId]);
                            }
                        } else {
                            // Send and forward with decremented TTL
                            if(newMessage[msgId].ttl != 0) {
                               var forwardMessage = {};
                               forwardMessage[msgId] = newMessage[msgId];
                               forwardMessage[msgId].ttl = forwardMessage[msgId].ttl - 1;
                               convertMessageToBuffer(forwardMessage, function(bufferedMessage) {
                                    socket.setBroadcast(true);
                                    socket.send(bufferedMessage, 0, bufferedMessage.length, port, host, function(err, bytes) {
                                        console.log("Got new message with id " + msgId + ", forwarding it.");
                                    });
                                });
                            }
                        }
                    }
                } else {
                   console.log("We have the same message with id " + msgId + ", just droping it");
                }
            }
        });
    });
});

socket.bind(port, host);

setInterval(function() {
    for (idx in messageBuffer) {
        var target = messageBuffer[idx].timeout;
        var now = new Date().getTime();
        console.log("Target:"+ target + ", Now:" + now);
        if(target>now){
            broadcastStorm(messageBuffer, idx, function(){});
        }
    }
}, 5000)
