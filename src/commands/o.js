const { MessageEmbed } = require(`discord.js`);
const { fetchuser } = require(`../utils/fetchuser`);
const Library = require(`../lib/index.js`);
const { Op } = require(`sequelize`);
const sortingFunc = (a, b) => parseInt(b.plays) - parseInt(a.plays);
let unique = new Set();
let period;
//const fs = require(`fs`);

/*
var artists_raw = 	fs.readFile(`${process.env.PWD}/artists.json`);
var artists = JSON.parse(artists_raw);
*/


const canvas = require(`canvas`);
canvas.registerFont(`${process.env.PWD}/NotoSansCJKjp-Regular.otf`, {
	family: `noto-sans`
});

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function removeDuplicates(array) {
	return array.filter((a, b) => array.indexOf(a) === b)
};

function getRandomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
};

const { generateChart } = require('../utils/chartUtils');

exports.run = async (client, message, args) => {
	await generateChart(client, message, args, 'overall');
};

exports.help = {
	name: 'o',
	description: '5x10 overall chart',
	usage: 'o <page #>'
};
