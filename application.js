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
var createMessage = function(content, destination, ttl, callback) {
    var message = {};

    // Generate random hash ID
    crypto.randomBytes(48, function(ex, buf) {
        var id = buf.toString('hex');
        message[id] = {};

        message[id].content = content;
        message[id].destination = destination;
        if(!ttl) {
            message[id].ttl = 5;
        } else {
            message[id].ttl = ttl;
        }

        messageBuffer[id] = message[id];

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
        createMessage(data.content, data.destination, 5, function(bufferedMessage) {
            socket.setBroadcast(true);
            socket.send(bufferedMessage, 0, bufferedMessage.length, port, host, function(err, bytes) {
                callback(err);
            });
        })
    });
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
                    console.log(newMessage[msgId]);
                    if(newMessage[msgId].destination in myIP) {
                        console.log("New message for us (id: " + msgId + "): " + newMessage[msgId].content);
                        if(ioSockGlobal) {
                            ioSockGlobal.emit('retrieveMessage', {content: newMessage[msgId].content});
                        }
                    } else {
                        // Send and forward with decremented TTL
                        if(newMessage[msgId].ttl != 0) {
                           var forwardMessage = {};
                           forwardMessage[msgId] = newMessage[msgId];
                           convertMessageToBuffer(forwardMessage, function(bufferedMessage) {
                                socket.setBroadcast(true);
                                socket.send(bufferedMessage, 0, bufferedMessage.length, port, host, function(err, bytes) {
                                   console.log("Got new message with id " + msgId + ", forwarding it.")
                                });
                           });
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
