module.exports = function injectEscapeChars(str) {
    let retStr = str;

    retStr = retStr.replace('*', '\\*');
    retStr = retStr.replace('_', '\\_');
    retStr = retStr.replace('||', '\\|\\|');

    return retStr;
}