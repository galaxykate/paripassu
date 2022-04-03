// in your application file — create the server
const SimplePeerServer = require('simple-peer-server');
const http = require('http');
const server = http.createServer();
const spServer = new SimplePeerServer(server);server.listen(8081);
// in your terminal — run it!
