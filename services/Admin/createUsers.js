import { getAdminConnection } from './sqlconfig_admin.js';
const createUsersTable = async () => {
  try {
    const pool = await getAdminConnection();
    const query = "IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' and xtype='U') BEGIN CREATE TABLE Users (id INT IDENTITY(1,1) PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, created_at DATETIME DEFAULT GETDATE()); INSERT INTO Users (username, password) VALUES ('admin', 'admin123'); PRINT 'Table created'; END ELSE BEGIN PRINT 'Table already exists'; END";
    await pool.request().query(query);
    console.log('Tabla de usuarios lista.');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
createUsersTable();
