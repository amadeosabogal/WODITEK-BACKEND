import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

let serverAddress = process.env.SQLSERVER_SERVER || "";
let port = 1433;

if (serverAddress.includes(":")) {
  const parts = serverAddress.split(":");
  serverAddress = parts[0];
  port = parseInt(parts[1], 10);
}

const config = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: serverAddress,
  database: "SMI_Inventario", // Apuntamos a la nueva base de datos
  port: port,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

let pool;

export const getInventarioConnection = async () => {
  try {
    if (pool) return pool;

    pool = new sql.ConnectionPool(config);
    await pool.connect();
    return pool;
  } catch (error) {
    console.error("Error al conectar con SQL Server (InventarioDB):", error);
    throw error;
  }
};
