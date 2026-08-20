import express from "express";
import cors from "cors";
import helmet from 'helmet';
import dotenv from "dotenv";
import gimnasioRouter from "./services/gimnasio/gimnasio.js";
import reservasRouter from "./services/reservas/reservas.js";
import sqlRouter from "./services/sql_server/sql_server.js";
import smiRouter from "./services/SMI/smi.js";
import landingRouter from "./services/SMI-LandingPage/landing.js";
import ccpRouter from "./services/CCP/ccp.js";
import pushRouter from "./services/push_notifications/push.js";
import srmRouter from "./SRM-Registros/srm.js";
import tkeRouter from "./services/TKE-OBS/tke.js";
import barberRouter from "./TheGarrison/barber.js";
import srhRouter from "./Logistica_SMI/srh.js";
import yapeRouter, { setupYapeSocket } from "./services/Yape/yapeRouter.js";
import adminRouter from "./services/Admin/adminRouter.js";

import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Permitir que cualquier dispositivo (Tablet/TV) se conecte
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7 // 10MB para manejar imágenes base64 pesadas
});

app.set('socketio', io);

const port = process.env.PORT || 3000;


// Seguridad HTTP
app.use(helmet());

// Configuración CORS restrictiva
const allowedOrigins = ['http://localhost:5173', 'http://localhost:5174', 'https://www.woditek.com'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  }
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ... resto de middlewares y rutas ...
app.use("/uploads", express.static("./services/TKE-OBS/uploads"));
app.use("/garrison/uploads", express.static("./TheGarrison/uploads/estilos"));
app.use("/srh/uploads", express.static("./Logistica_SMI/uploads"));
app.use("/srm/uploads", express.static("./SRM-Registros/uploads"));

app.use("/gimnasio", gimnasioRouter);
app.use("/reservas", reservasRouter);
app.use("/sql", sqlRouter);
app.use("/smi", smiRouter);
app.use("/landing", landingRouter);
app.use("/ccp", ccpRouter);
app.use("/push", pushRouter);
app.use("/srm", srmRouter);
app.use("/tke", tkeRouter);
app.use("/srh", srhRouter);
app.use("/yape", yapeRouter);
app.use("/admin", adminRouter);

// Aislamiento: El sistema de WebSockets (req.io) SOLO se inyectará en las rutas de The Garrison
app.use("/barber", (req, res, next) => {
  req.io = io;
  next();
}, barberRouter);

io.on("connection", (socket) => {
  console.log("Nuevo dispositivo conectado (Tablet o TV):", socket.id);
});

// Inicializa el escuchador de Yape para sockets:
setupYapeSocket(io);

httpServer.listen(port, () =>
  console.log(`Servidor con WebSockets corriendo en puerto: ${port}`)
);
