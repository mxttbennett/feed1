const { generateChart } = require('../utils/chartUtils');

exports.run = async (client, message, args) => {
  await generateChart(client, message, args, 'sixMonth');
};

exports.help = {
  name: '6m',
  description: '5x10 6-month chart',
  usage: '6m <page #>'
};
