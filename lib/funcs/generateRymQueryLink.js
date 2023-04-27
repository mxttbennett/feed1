const urlEncodeString = require('./urlEncodeString');

module.exports = function generateRymQueryLink(artistName, albumName = null) {
    let query = artistName;

    // if albumName is present, add the album name, separated by a space, to the query
    if (albumName !== null) {
        query += ` ${albumName}`
    }

    encodedQuery = urlEncodeString(query)

    return `https://www.google.com/search?q=${encodedQuery}&as_sitesearch=rateyourmusic.com`

    // .setDescription(`[**${track.artist[`#text`]}**](http://www.google.com/search?q=${art}&as_sitesearch=rateyourmusic.com 'search rym for ${origart}')\n` +
    // `[***${track.album[`#text`] ?? `[no album]`}***](http://www.google.com/search?q=${art}${alb}&as_sitesearch=rateyourmusic.com 'search rym for ${origart} - ${origalb}')`, true)

}