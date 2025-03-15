const { stringify } = require(`querystring`);
const { get } = require(`https`);

class LastFMClient {
  constructor(apikey) {
    this.apikey = apikey;
    this.rootURL = `https://ws.audioscrobbler.com/2.0/?`;
    this.stringify = stringify;
    this.get = get;
  }

  request(url) {
    return new Promise((resolve, reject) => {
      get(url, res => {
        let rawData = ``;
        res.on(`data`, chunk => rawData += chunk);
        res.on(`end`, () => {
          if (res.statusCode !== 200) {
            const error = new Error(`Last.fm API request failed`);
            error.statusCode = res.statusCode;
            error.endpoint = url;
            error.response = rawData;
            
            // Try to parse error details from response
            try {
              const data = JSON.parse(rawData);
              if (data.error) {
                error.message = `Last.fm API Error ${data.error}: ${data.message}`;
                error.code = data.error;
              }
            } catch (e) {
              error.message = `Last.fm API request failed with status ${res.statusCode}`;
            }
            
            reject(error);
            return;
          }

          try {
            const data = JSON.parse(rawData);
            if (data.error) {
              const error = new Error(`Last.fm API Error ${data.error}: ${data.message}`);
              error.statusCode = res.statusCode;
              error.endpoint = url;
              error.response = rawData;
              error.code = data.error;
              reject(error);
              return;
            }
            resolve(data);
          } catch (error) {
            error.message = `Failed to parse Last.fm API response: ${error.message}`;
            error.rawData = rawData;
            error.endpoint = url;
            reject(error);
          }
        });
      }).on(`error`, error => {
        error.message = `Network error making Last.fm API request: ${error.message}`;
        error.endpoint = url;
        reject(error);
      });
    });
  }
}

module.exports = LastFMClient;
