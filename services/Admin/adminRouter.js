import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import sql from 'mssql';
import { getAdminConnection } from './sqlconfig_admin.js';

const router = express.Router();

// Middleware to get pool
router.use(async (req, res, next) => {
    try {
        req.pool = await getAdminConnection();
        next();
    } catch (error) {
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// ==========================================
// SEGURIDAD Y LOGIN
// ==========================================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Limitar cada IP a 5 peticiones por ventana
  message: { error: 'Demasiados intentos de login, intenta de nuevo en 15 minutos.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }

    const pool = req.pool;
    
    const query = `
      SELECT id, username, password 
      FROM Users 
      WHERE username = @username
    `;
    
    const result = await pool.request()
      .input('username', username) // mssql inferirá VarChar
      .query(query);

    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      
      // Verificar contraseña con bcrypt
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Credenciales inválidas.' });
      }

      // Generar JWT
      const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET || 'super_secret_key_change_me',
        { expiresIn: '8h' }
      );

      return res.status(200).json({ 
        message: 'Login exitoso', 
        token,
        user: { id: user.id, username: user.username } 
      });
    } else {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }
  } catch (error) {
    console.error("Error en login:", error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Middleware para verificar JWT en el resto de las rutas
const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers['authorization'];
  if (typeof bearerHeader !== 'undefined') {
    const bearer = bearerHeader.split(' ');
    const bearerToken = bearer[1];
    
    jwt.verify(bearerToken, process.env.JWT_SECRET || 'super_secret_key_change_me', (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
      }
      req.user = decoded;
      next();
    });
  } else {
    return res.status(403).json({ error: 'No autorizado. Se requiere token.' });
  }
};

// ==========================================
// RUTAS ABIERTAS (DECOLECTA) - No requieren Token
// ==========================================
// ==========================================
// DECOLECTA API PROXIES
// ==========================================

router.get('/sunat/:ruc', async (req, res) => {
    try {
        const { ruc } = req.params;
        const response = await fetch(`https://api.decolecta.com/v1/sunat/ruc?numero=${ruc}`, {
            headers: {
                'Authorization': `Bearer ${process.env.DECOLECTA_TOKEN}`
            }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/reniec/:dni', async (req, res) => {
    try {
        const { dni } = req.params;
        const response = await fetch(`https://api.decolecta.com/v1/reniec/dni?numero=${dni}`, {
            headers: {
                'Authorization': `Bearer ${process.env.DECOLECTA_TOKEN}`
            }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Protegemos todas las rutas siguientes
router.use(verifyToken);

// ==========================================
// CLIENTES
// ==========================================
router.get('/clientes', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, Tipo as type, Documento as document, Nombre as name, FechaCreacion as createdAt FROM Clientes');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/clientes', async (req, res) => {
    try {
        const { id, type, document, name, createdAt } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), id)
            .input('tipo', sql.NVarChar(20), type)
            .input('documento', sql.NVarChar(20), document)
            .input('nombre', sql.NVarChar(200), name)
            .input('fechaCreacion', sql.NVarChar(50), createdAt)
            .query('INSERT INTO Clientes (Id, Tipo, Documento, Nombre, FechaCreacion) VALUES (@id, @tipo, @documento, @nombre, @fechaCreacion)');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/clientes/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Clientes WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// TRABAJADORES
// ==========================================
router.get('/trabajadores', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, NombreCompleto as fullName, Dni as dni, Rol as role, FechaCreacion as createdAt FROM Trabajadores');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/trabajadores', async (req, res) => {
    try {
        const { id, fullName, dni, role, createdAt } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), id)
            .input('fullName', sql.NVarChar(200), fullName)
            .input('dni', sql.NVarChar(20), dni)
            .input('role', sql.NVarChar(100), role)
            .input('createdAt', sql.NVarChar(50), createdAt)
            .query('INSERT INTO Trabajadores (Id, NombreCompleto, Dni, Rol, FechaCreacion) VALUES (@id, @fullName, @dni, @role, @createdAt)');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/trabajadores/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Trabajadores WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// PROYECTOS
// ==========================================
router.get('/proyectos', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, ClienteId as clientId, Nombre as name, PagoInicial50 as paidInitial50, PagoFinal50 as paidFinal50, FechaCreacion as createdAt FROM Proyectos');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/proyectos', async (req, res) => {
    try {
        const { id, clientId, name, paidInitial50, paidFinal50, createdAt } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), id)
            .input('clientId', sql.VarChar(50), clientId)
            .input('name', sql.NVarChar(200), name)
            .input('paidInitial50', sql.Bit, paidInitial50)
            .input('paidFinal50', sql.Bit, paidFinal50)
            .input('createdAt', sql.NVarChar(50), createdAt)
            .query('INSERT INTO Proyectos (Id, ClienteId, Nombre, PagoInicial50, PagoFinal50, FechaCreacion) VALUES (@id, @clientId, @name, @paidInitial50, @paidFinal50, @createdAt)');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/proyectos/:id', async (req, res) => {
    try {
        const { clientId, name, paidInitial50, paidFinal50, createdAt } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .input('clientId', sql.VarChar(50), clientId)
            .input('name', sql.NVarChar(200), name)
            .input('paidInitial50', sql.Bit, paidInitial50)
            .input('paidFinal50', sql.Bit, paidFinal50)
            .input('createdAt', sql.NVarChar(50), createdAt)
            .query('UPDATE Proyectos SET ClienteId=@clientId, Nombre=@name, PagoInicial50=@paidInitial50, PagoFinal50=@paidFinal50, FechaCreacion=@createdAt WHERE Id=@id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/proyectos/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Proyectos WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// INGRESOS
// ==========================================
router.get('/ingresos', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, Fecha as date, Descripcion as description, Monto as amount, Banco as bank FROM Ingresos');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/ingresos', async (req, res) => {
    try {
        const { id, date, description, amount, bank } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), id)
            .input('date', sql.NVarChar(50), date)
            .input('description', sql.NVarChar(255), description)
            .input('amount', sql.Decimal(18,2), amount)
            .input('bank', sql.NVarChar(50), bank)
            .query('INSERT INTO Ingresos (Id, Fecha, Descripcion, Monto, Banco) VALUES (@id, @date, @description, @amount, @bank)');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/ingresos/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Ingresos WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ADELANTOS
// ==========================================
router.get('/adelantos', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, NombreTrabajador as workerName, TotalAPagar as totalToPay, MontoEntregado as amountGiven, Fecha as date, Banco as bank FROM Adelantos');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/adelantos', async (req, res) => {
    try {
        const { id, workerName, totalToPay, amountGiven, date, bank } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), id)
            .input('workerName', sql.NVarChar(200), workerName)
            .input('totalToPay', sql.Decimal(18,2), totalToPay)
            .input('amountGiven', sql.Decimal(18,2), amountGiven)
            .input('date', sql.NVarChar(50), date)
            .input('bank', sql.NVarChar(50), bank)
            .query('INSERT INTO Adelantos (Id, NombreTrabajador, TotalAPagar, MontoEntregado, Fecha, Banco) VALUES (@id, @workerName, @totalToPay, @amountGiven, @date, @bank)');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/adelantos/:id', async (req, res) => {
    try {
        const { workerName, totalToPay, amountGiven, date, bank } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .input('workerName', sql.NVarChar(200), workerName)
            .input('totalToPay', sql.Decimal(18,2), totalToPay)
            .input('amountGiven', sql.Decimal(18,2), amountGiven)
            .input('date', sql.NVarChar(50), date)
            .input('bank', sql.NVarChar(50), bank)
            .query('UPDATE Adelantos SET NombreTrabajador=@workerName, TotalAPagar=@totalToPay, MontoEntregado=@amountGiven, Fecha=@date, Banco=@bank WHERE Id=@id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/adelantos/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Adelantos WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// PAGOS
// ==========================================
router.get('/pagos', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, Descripcion as description, Monto as amount, Fecha as date, Banco as bank FROM Pagos');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/pagos', async (req, res) => {
    try {
        const { id, description, amount, date, bank } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), id)
            .input('description', sql.NVarChar(255), description)
            .input('amount', sql.Decimal(18,2), amount)
            .input('date', sql.NVarChar(50), date)
            .input('bank', sql.NVarChar(50), bank)
            .query('INSERT INTO Pagos (Id, Descripcion, Monto, Fecha, Banco) VALUES (@id, @description, @amount, @date, @bank)');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/pagos/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Pagos WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// DEUDAS CLIENTES
// ==========================================
router.get('/deudas', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, NombreCliente as clientName, PagoAdelanto50 as paidAdvance50, PagoFinal50 as paidFinal50, VencimientoLicencia as licenseExpiration, ProyectoId as projectId, MontoFinalConIgv as finalAmountWithIgv FROM DeudasClientes');
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/deudas', async (req, res) => {
    try {
        const { id, clientName, paidAdvance50, paidFinal50, licenseExpiration, projectId, finalAmountWithIgv } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), id)
            .input('clientName', sql.NVarChar(200), clientName)
            .input('paidAdvance50', sql.Bit, paidAdvance50)
            .input('paidFinal50', sql.Bit, paidFinal50)
            .input('licenseExpiration', sql.NVarChar(50), licenseExpiration)
            .input('projectId', sql.VarChar(50), projectId || null)
            .input('finalAmountWithIgv', sql.Decimal(18,2), finalAmountWithIgv || null)
            .query('INSERT INTO DeudasClientes (Id, NombreCliente, PagoAdelanto50, PagoFinal50, VencimientoLicencia, ProyectoId, MontoFinalConIgv) VALUES (@id, @clientName, @paidAdvance50, @paidFinal50, @licenseExpiration, @projectId, @finalAmountWithIgv)');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/deudas/:id', async (req, res) => {
    try {
        const { clientName, paidAdvance50, paidFinal50, licenseExpiration, projectId, finalAmountWithIgv } = req.body;
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .input('clientName', sql.NVarChar(200), clientName)
            .input('paidAdvance50', sql.Bit, paidAdvance50)
            .input('paidFinal50', sql.Bit, paidFinal50)
            .input('licenseExpiration', sql.NVarChar(50), licenseExpiration)
            .input('projectId', sql.VarChar(50), projectId || null)
            .input('finalAmountWithIgv', sql.Decimal(18,2), finalAmountWithIgv || null)
            .query('UPDATE DeudasClientes SET NombreCliente=@clientName, PagoAdelanto50=@paidAdvance50, PagoFinal50=@paidFinal50, VencimientoLicencia=@licenseExpiration, ProyectoId=@projectId, MontoFinalConIgv=@finalAmountWithIgv WHERE Id=@id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/deudas/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM DeudasClientes WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// COTIZACIONES
// ==========================================
router.get('/cotizaciones', async (req, res) => {
    try {
        const result = await req.pool.request().query('SELECT Id as id, ClienteId as clientId, Descripcion as description, MontoBase as baseAmount, PorcentajeImpuesto as taxPercent, Pagado50Porciento as paid50Percent, FechaCreacion as createdAt, Moneda as currency, TipoCambio as exchangeRate, TiempoDesarrollo as developmentTime FROM Cotizaciones');
        const quotes = result.recordset;
        
        const itemsResult = await req.pool.request().query('SELECT CotizacionId as quoteId, Descripcion as description, Cantidad as quantity, PrecioUnitario as unitPrice, Moneda as currency, TipoCambio as exchangeRate FROM Cotizacion_Items');
        const items = itemsResult.recordset;
        
        quotes.forEach(q => {
            q.items = items.filter(i => i.quoteId === q.id);
        });
        
        res.json(quotes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/cotizaciones', async (req, res) => {
    try {
        const { id, clientId, description, baseAmount, taxPercent, paid50Percent, createdAt, currency, exchangeRate, developmentTime, items } = req.body;
        
        const transaction = new sql.Transaction(req.pool);
        await transaction.begin();
        
        try {
            const request = new sql.Request(transaction);
            await request
                .input('id', sql.VarChar(50), id)
                .input('clientId', sql.VarChar(50), clientId || null)
                .input('description', sql.NVarChar(sql.MAX), description)
                .input('baseAmount', sql.Decimal(18,2), baseAmount)
                .input('taxPercent', sql.Decimal(5,2), taxPercent)
                .input('paid50Percent', sql.Bit, paid50Percent)
                .input('createdAt', sql.NVarChar(50), createdAt)
                .input('currency', sql.NVarChar(10), currency || null)
                .input('exchangeRate', sql.Decimal(10,4), exchangeRate || null)
                .input('developmentTime', sql.NVarChar(100), developmentTime || null)
                .query('INSERT INTO Cotizaciones (Id, ClienteId, Descripcion, MontoBase, PorcentajeImpuesto, Pagado50Porciento, FechaCreacion, Moneda, TipoCambio, TiempoDesarrollo) VALUES (@id, @clientId, @description, @baseAmount, @taxPercent, @paid50Percent, @createdAt, @currency, @exchangeRate, @developmentTime)');
            
            if (items && items.length > 0) {
                for (const item of items) {
                    const itemReq = new sql.Request(transaction);
                    await itemReq
                        .input('quoteId', sql.VarChar(50), id)
                        .input('description', sql.NVarChar(sql.MAX), item.description)
                        .input('quantity', sql.Int, item.quantity)
                        .input('unitPrice', sql.Decimal(18,2), item.unitPrice)
                        .input('currency', sql.NVarChar(10), item.currency || null)
                        .input('exchangeRate', sql.Decimal(10,4), item.exchangeRate || null)
                        .query('INSERT INTO Cotizacion_Items (CotizacionId, Descripcion, Cantidad, PrecioUnitario, Moneda, TipoCambio) VALUES (@quoteId, @description, @quantity, @unitPrice, @currency, @exchangeRate)');
                }
            }
            
            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/cotizaciones/:id', async (req, res) => {
    try {
        const { clientId, description, baseAmount, taxPercent, paid50Percent, createdAt, currency, exchangeRate, developmentTime, items } = req.body;
        const id = req.params.id;
        
        const transaction = new sql.Transaction(req.pool);
        await transaction.begin();
        
        try {
            const request = new sql.Request(transaction);
            await request
                .input('id', sql.VarChar(50), id)
                .input('clientId', sql.VarChar(50), clientId || null)
                .input('description', sql.NVarChar(sql.MAX), description)
                .input('baseAmount', sql.Decimal(18,2), baseAmount)
                .input('taxPercent', sql.Decimal(5,2), taxPercent)
                .input('paid50Percent', sql.Bit, paid50Percent)
                .input('createdAt', sql.NVarChar(50), createdAt)
                .input('currency', sql.NVarChar(10), currency || null)
                .input('exchangeRate', sql.Decimal(10,4), exchangeRate || null)
                .input('developmentTime', sql.NVarChar(100), developmentTime || null)
                .query('UPDATE Cotizaciones SET ClienteId=@clientId, Descripcion=@description, MontoBase=@baseAmount, PorcentajeImpuesto=@taxPercent, Pagado50Porciento=@paid50Percent, FechaCreacion=@createdAt, Moneda=@currency, TipoCambio=@exchangeRate, TiempoDesarrollo=@developmentTime WHERE Id=@id');
            
            // Delete old items
            const delReq = new sql.Request(transaction);
            await delReq.input('id', sql.VarChar(50), id).query('DELETE FROM Cotizacion_Items WHERE CotizacionId = @id');
            
            // Insert new items
            if (items && items.length > 0) {
                for (const item of items) {
                    const itemReq = new sql.Request(transaction);
                    await itemReq
                        .input('quoteId', sql.VarChar(50), id)
                        .input('description', sql.NVarChar(sql.MAX), item.description)
                        .input('quantity', sql.Int, item.quantity)
                        .input('unitPrice', sql.Decimal(18,2), item.unitPrice)
                        .input('currency', sql.NVarChar(10), item.currency || null)
                        .input('exchangeRate', sql.Decimal(10,4), item.exchangeRate || null)
                        .query('INSERT INTO Cotizacion_Items (CotizacionId, Descripcion, Cantidad, PrecioUnitario, Moneda, TipoCambio) VALUES (@quoteId, @description, @quantity, @unitPrice, @currency, @exchangeRate)');
                }
            }
            
            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/cotizaciones/:id', async (req, res) => {
    try {
        await req.pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Cotizaciones WHERE Id = @id');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
