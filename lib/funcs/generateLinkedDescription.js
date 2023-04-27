const generateRymQueryLink = require('./generateRymQueryLink')
const injectEscapeChars = require('./injectEscapeChars')

module.exports = function generateLinkedDescription(artistName, albumName = null) {
    let retDesc = `[**${injectEscapeChars(artistName)}**](${generateRymQueryLink(artistName)} 'search rym for ${artistName}')\n`
    if (albumName === null) {
        retDesc += 'no album'
    }
    else {
        retDesc += `[***${injectEscapeChars(albumName)}***](${generateRymQueryLink(artistName, albumName)} 'search rym for ${artistName} - ${albumName}')`
    }

    return retDesc
}