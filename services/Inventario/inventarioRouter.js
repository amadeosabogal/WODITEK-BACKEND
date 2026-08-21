import { Router } from "express";
import { getInventarioConnection } from "./sqlconfig_inventario.js";
import sql from "mssql";
import jwt from "jsonwebtoken";
import { authenticateToken } from "../middlewares/authMiddleware.js";

const router = Router();

// ==============================
// 1. LOGIN
// ==============================
router.post("/login", async (req, res) => {
    const { usuario, password } = req.body;
    
    if (!usuario || !password) {
        return res.status(400).json({ error: "Usuario y contraseña son requeridos" });
    }

    try {
        const pool = await getInventarioConnection();
        const result = await pool
            .request()
            .input("usuario", usuario)
            .input("password", password)
            .query("SELECT id, usuario, rol FROM Usuarios WHERE usuario = @usuario AND password = @password AND estado = 'ACTIVO'");

        if (result.recordset.length > 0) {
            const user = result.recordset[0];
            const token = jwt.sign(
                { id: user.id, rol: user.rol }, 
                process.env.JWT_SECRET, 
                { expiresIn: '8h' }
            );

            return res.status(200).json({ 
                message: "Login exitoso", 
                user: user,
                token: token
            });
        } else {
            return res.status(401).json({ error: "Credenciales inválidas o usuario inactivo" });
        }
    } catch (err) {
        console.error("Error en login inventario:", err);
        return res.status(500).json({ error: "Error en el servidor al intentar iniciar sesión" });
    }
});

// ==============================
// MIDDLEWARE DE AUTENTICACIÓN
// ==============================
// Todas las rutas debajo de esta línea requieren token válido
router.use(authenticateToken);

// ==============================
// 2. EPP (ALMACÉN)
// ==============================
router.get("/epp", async (req, res) => {
    try {
        const pool = await getInventarioConnection();
        const result = await pool.request().query("SELECT * FROM EPP ORDER BY createdAt DESC");
        return res.status(200).json(result.recordset);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener EPPs" });
    }
});

router.post("/epp", async (req, res) => {
    const { id, nombre, categoria, marca, talla, stockActual, stockMinimo } = req.body;
    try {
        const pool = await getInventarioConnection();
        await pool.request()
            .input("id", id)
            .input("nombre", nombre)
            .input("categoria", categoria || null)
            .input("marca", marca || null)
            .input("talla", talla || null)
            .input("stockActual", stockActual || 0)
            .input("stockMinimo", stockMinimo || 0)
            .query(`
                INSERT INTO EPP (id, nombre, categoria, marca, talla, stockActual, stockMinimo, createdAt)
                VALUES (@id, @nombre, @categoria, @marca, @talla, @stockActual, @stockMinimo, GETDATE())
            `);
        return res.status(201).json({ message: "EPP creado exitosamente" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear EPP" });
    }
});

router.post("/epp/movimiento", async (req, res) => {
    const { eppId, tipo, cantidad, motivo, responsable } = req.body;
    try {
        const pool = await getInventarioConnection();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Actualizar stock
            const stockQuery = tipo === 'ENTRADA' 
                ? "UPDATE EPP SET stockActual = stockActual + @cantidad WHERE id = @eppId"
                : "UPDATE EPP SET stockActual = stockActual - @cantidad WHERE id = @eppId";

            await transaction.request()
                .input("cantidad", cantidad)
                .input("eppId", eppId)
                .query(stockQuery);

            // Registrar movimiento
            await transaction.request()
                .input("id", `mov-${Date.now()}`)
                .input("tipo", tipo)
                .input("eppId", eppId)
                .input("cantidad", cantidad)
                .input("responsable", responsable || 'Sistema')
                .input("observacion", motivo)
                .query(`
                    INSERT INTO Movimientos (id, fecha, tipo, eppId, cantidad, responsable, observacion, createdAt)
                    VALUES (@id, GETDATE(), @tipo, @eppId, @cantidad, @responsable, @observacion, GETDATE())
                `);

            await transaction.commit();
            return res.status(200).json({ message: "Movimiento registrado exitosamente" });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al registrar movimiento" });
    }
});

// ==============================
// 3. TRABAJADORES
// ==============================
router.get("/trabajadores", async (req, res) => {
    try {
        const pool = await getInventarioConnection();
        const result = await pool.request().query("SELECT * FROM Trabajadores ORDER BY nombreCompleto ASC");
        return res.status(200).json(result.recordset);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener trabajadores" });
    }
});

router.post("/trabajadores", async (req, res) => {
    const { id, dni, nombreCompleto, area } = req.body;
    try {
        const pool = await getInventarioConnection();
        await pool.request()
            .input("id", id)
            .input("dni", dni)
            .input("nombreCompleto", nombreCompleto)
            .input("area", area || null)
            .query(`
                INSERT INTO Trabajadores (id, dni, nombreCompleto, area, createdAt)
                VALUES (@id, @dni, @nombreCompleto, @area, GETDATE())
            `);
        return res.status(201).json({ message: "Trabajador creado exitosamente" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear trabajador" });
    }
});

// ==============================
// 4. ENTREGAS
// ==============================
router.get("/entregas", async (req, res) => {
    try {
        const pool = await getInventarioConnection();
        // Hacemos JOIN para obtener el nombre del EPP y Trabajador
        const result = await pool.request().query(`
            SELECT en.*, t.nombreCompleto as trabajadorNombre, e.nombre as eppNombre
            FROM Entregas en
            LEFT JOIN Trabajadores t ON en.trabajadorId = t.id
            LEFT JOIN EPP e ON en.eppId = e.id
            ORDER BY en.fecha DESC
        `);
        return res.status(200).json(result.recordset);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener entregas" });
    }
});

router.post("/entregas", async (req, res) => {
    const { id, trabajadorId, eppId, cantidad, motivo, firma } = req.body;
    try {
        const pool = await getInventarioConnection();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Reducir stock del EPP
            await transaction.request()
                .input("cantidad", cantidad)
                .input("eppId", eppId)
                .query("UPDATE EPP SET stockActual = stockActual - @cantidad WHERE id = @eppId");

            // 2. Registrar en Kardex (Movimientos) como SALIDA
            await transaction.request()
                .input("movId", `mov-${Date.now()}`)
                .input("eppId", eppId)
                .input("cantidad", cantidad)
                .input("motivo", `Entrega a trabajador - Motivo: ${motivo}`)
                .query(`
                    INSERT INTO Movimientos (id, fecha, tipo, eppId, cantidad, responsable, observacion, createdAt)
                    VALUES (@movId, GETDATE(), 'SALIDA', @eppId, @cantidad, 'Sistema', @motivo, GETDATE())
                `);

            // 3. Crear el registro de Entrega
            await transaction.request()
                .input("id", id || `ent-${Date.now()}`)
                .input("trabajadorId", trabajadorId)
                .input("eppId", eppId)
                .input("cantidad", cantidad)
                .input("motivo", motivo)
                .input("firma", firma || null)
                .query(`
                    INSERT INTO Entregas (id, fecha, trabajadorId, eppId, cantidad, motivo, firma, createdAt)
                    VALUES (@id, GETDATE(), @trabajadorId, @eppId, @cantidad, @motivo, @firma, GETDATE())
                `);

            await transaction.commit();
            return res.status(201).json({ message: "Entrega registrada exitosamente" });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al registrar entrega" });
    }
});

// ==============================
// 5. KARDEX (MOVIMIENTOS)
// ==============================
router.get("/movimientos", async (req, res) => {
    try {
        const pool = await getInventarioConnection();
        const result = await pool.request().query(`
            SELECT m.*, e.nombre as eppNombre
            FROM Movimientos m
            LEFT JOIN EPP e ON m.eppId = e.id
            ORDER BY m.fecha DESC
        `);
        return res.status(200).json(result.recordset);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener movimientos" });
    }
});

// ==============================
// 6. DASHBOARD STATS
// ==============================
router.get("/stats", async (req, res) => {
    try {
        const pool = await getInventarioConnection();
        
        // Ejecutar varias consultas en paralelo
        const eppsQuery = pool.request().query("SELECT COUNT(*) as count FROM EPP");
        const trabajadoresQuery = pool.request().query("SELECT COUNT(*) as count FROM Trabajadores");
        const bajoStockQuery = pool.request().query("SELECT COUNT(*) as count FROM EPP WHERE stockActual <= stockMinimo");
        const entregasQuery = pool.request().query("SELECT COUNT(*) as count FROM Entregas");
        
        const [epps, trabajadores, bajoStock, entregas] = await Promise.all([
            eppsQuery, trabajadoresQuery, bajoStockQuery, entregasQuery
        ]);

        return res.status(200).json({
            totalEPP: epps.recordset[0].count,
            totalTrabajadores: trabajadores.recordset[0].count,
            itemsBajoStock: bajoStock.recordset[0].count,
            totalEntregas: entregas.recordset[0].count
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener estadísticas" });
    }
});

export default router;
