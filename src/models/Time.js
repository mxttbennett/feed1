module.exports = (sequelize, DataTypes) => {
  return sequelize.define('times', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    ms: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    isArtist: {
      type: DataTypes.STRING,
      allowNull: false
    },
    isAlbum: {
      type: DataTypes.STRING,
      defaultValue: 'false'
    },
    guildID: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: false
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE
  }, {
    indexes: []
  });
};
