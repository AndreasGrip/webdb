import * as http from "http";

const db = {};

function isObject(data) {
  return typeof data === 'object' && !Array.isArray(data) && data !== null;
}

// function that test if string is valid json
function isJSON(data) {
  try {
    JSON.parse(data);
    return true;
  } catch (error) {
    return false;
  }
}

// function that test if value is integer
function isInteger(value) {
  return Number.isInteger(value);
}

export class WebServer {
  constructor(webserverSettings = {}, database = {}) {
    this.webserverIp = (typeof webserverSettings?.ip === 'string' && webserverSettings.ip.match(/^\d{1,3}[.]\d{1,3}[.]\d{1,3}[.]\d{1,3}$/) && webserverSettings.ip.split('.').every((s) => s >= 0 && s <= 255)) ? webserverSettings.ip : '0.0.0.0';
    this.webserverPort = isInteger(webserverSettings?.port) ? webserverSettings.port : 3075;
    // if object is passed use it as database, otherwise create empty object.
    this.db = isObject(database) ? database : {};
    this.startHttpServer(this.webserverPort);
  }

  // Thanks to myself for building such a excellent bare bone webserver for the dialer project :P
  startHttpServer(port) {
    const db = this.db;
    if (isInteger(port)) this.webserverPort = port;
    if (this.webserverPort) {
      this.httpServer = http.createServer((req, res) => {
        let dataRaw = []; // This can be transformed into other object types along the way.

        // Collect the data as Buffer chunks
        req.on('data', (chunk) => {
          dataRaw.push(chunk); // Store the Buffer chunks without converting
        });

        // Listen for the 'end' event when all chunks has been received
        // There is no reason to start processing data before this is done, it will just consume memory longer than necessary
        req.on('end', () => {
          const url = new URL('http://' + req.headers.host + req.url);
          // remove leading and trailing slash (/)
          const pathnameArray = url.pathname.replace(/^\/|\/$/g, '').split('/');
          const pathnameArrayCopy = JSON.parse(JSON.stringify(pathnameArray));
          const params = url.searchParams;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 404; // Default to not found.

          // set the entire db as a staring point for both response, parent and grandparent.
          let response = db;
          let parent = db;
          let grandparent = db;

          // some parameters to keep track on what's going on.
          let responseFound = false;
          let parentFound = false;
          let grandparentFound = false;
          let responseFoundLast = false;

          // test if a object with the requested name exists in db
          for (let i = 0; i < pathnameArrayCopy.length; i++) {
            // ignore empty "paths"
            if (pathnameArrayCopy[i] !== '') {
              // Make the parent to the old response.
              grandparent = parent;
              parent = response;
              response = response[pathnameArrayCopy[i]];
            }
            if (i === pathnameArrayCopy.length - 1) responseFoundLast = true;
            if (response === undefined) break;
          }

          if (response !== undefined) responseFound = true;
          if (response !== parent) parentFound = true;
          if (parent !== grandparent) grandparentFound = true;

          switch (req.method) {
            case 'GET':
              if (response !== undefined) {
                // Handle columns to fetch starts here
                const uniqueParams = []; // create a list of params without duplicates

                let cols_tmp = params.getAll('cols'); // The original cols params
                const cols = []; // the cols after splitting by ',' (cols=apa,apa2,apa3 instead of cols=apa&cols=apa2&cols=apa3)
                if (cols_tmp.length > 0) {
                  cols_tmp.forEach((col) => {
                    cols.push(...col.split(','));
                  });
                }
                // Handle columns to fetch ends here

                // Create an array of the unique params (filters)
                for (const key of params.keys()) {
                  // Include to array if not already included and not 'cols' as cols are handled separately
                  if (!uniqueParams.includes(key) && key !== 'cols') uniqueParams.push(key);
                }

                // If there is any filter AND this is an array
                // TODO: support filter on objects as well.
                if (uniqueParams.length > 0 && Array.isArray(response)) {
                  response = response.filter((r) => {
                    let include = false;
                    if (isObject(r)) {
                      for (let i = 0; i < uniqueParams.length; i++) {
                        if (params.get(uniqueParams[i]) && isObject(r[uniqueParams[i]]) && Object.keys(r[uniqueParams[i]]).includes(params.getAll(uniqueParams[i]))) {
                          include = true;
                          break;
                        }
                      }
                    }
                    return include;
                  });
                }

                if (cols.length > 0) {
                  // as we going to change the contents and this object contains pointers we need to make a carbon copy now
                  response = JSON.parse(JSON.stringify(response));
                  response.forEach((r) => {
                    // cols only existing in response and not in cols
                    Object.keys((k) => {
                      if (!cols.includes(k)) delete r[k];
                    });
                  });
                }
                res.write(response ? JSON.stringify(response, null, 2) : '');
              }

              break;
            case 'POST':
              // Add new resource
              // things can only be added to arrays
              if (responseFound) {
                if (Array.isArray(response)) {
                  let data = Buffer.concat(dataRaw).toString();
                  // if JSON it's an object and should be merged.
                  if (isJSON(data)) {
                    data = JSON.parse(data);
                  }
                  response.push(data);
                  res.statusCode = 200;
                } else {
                  res.statusCode = 405;
                }
              }
              break;
            case 'PUT':
            // Update entire resource
            if (responseFoundLast) {
                let data = Buffer.concat(dataRaw).toString();
                if (isJSON(data)) {
                  data = JSON.parse(data);
                  parent[pathnameArrayCopy[pathnameArrayCopy.length - 1]] = data;
                  res.statusCode = 200;
                } else {
                  res.statusCode = 400;
                }
              }
              break;
            case 'PATCH':
              // Update parts of object already present, otherwise create them.
              
              if (responseFoundLast && response !== undefined) {
                let data = Buffer.concat(dataRaw).toString();
                // if JSON it's an object and should be merged.
                if (isJSON(data)) {
                  data = JSON.parse(data);
                  Object.assign(parent[pathnameArrayCopy[pathnameArrayCopy.length - 1]], data);
                } else {
                  parent[pathnameArrayCopy[pathnameArrayCopy.length - 1]] = data;
                }
                res.statusCode = 200;
              }
              break;
            // Update part of resource (merge)
            case 'DELETE':
              if (responseFoundLast && response !== undefined) {
                delete parent[pathnameArrayCopy[pathnameArrayCopy.length - 1]];
                res.statusCode = 204;
              }
              break;
            default:
              break;
          }
          res.end();
        });
      });
      this.httpServer.listen(this.webserverPort, this.webserverIp); //the server object listens on port 8080
      console.log('http server started on port ' + this.webserverPort);
    }
  }
}
