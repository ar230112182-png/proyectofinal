const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

router.post('/login', async (request, response, next) => {
  try {
    const { correo, contrasena } = request.body;

    if (!correo || !contrasena) {
      return response.status(400).json({
        error: 'Correo y contrasena son obligatorios.',
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM public.usuarios
       WHERE LOWER(TRIM(correo)) = LOWER(TRIM($1))
       LIMIT 1`,
      [correo]
    );

    const user = result.rows[0];

    if (!user) {
      return response.status(401).json({
        error: 'Las credenciales no son validas.',
      });
    }

    const storedPassword = user.contrasena ?? user.password;
    const passwordColumn = Object.prototype.hasOwnProperty.call(user, 'contrasena') ? 'contrasena' : 'password';
    let passwordValid = false;

    if (storedPassword?.startsWith('$2')) {
      passwordValid = await bcrypt.compare(contrasena, storedPassword);
    } else {
      passwordValid = storedPassword === contrasena;

      if (passwordValid && storedPassword !== null && storedPassword !== undefined) {
        const passwordHash = await bcrypt.hash(contrasena, 12);

        await pool.query(
          `UPDATE public.usuarios
           SET ${passwordColumn} = $1
           WHERE id_usuario = $2`,
          [passwordHash, user.id_usuario]
        );
      }
    }

    if (!passwordValid) {
      return response.status(401).json({
        error: 'Las credenciales no son validas.',
      });
    }

    const storedRole = user.rol ?? 'cliente';
    const rol = ['admin', 'administrador'].includes(storedRole)
      ? 'administrador'
      : ['agente', 'vendedor'].includes(storedRole)
        ? 'vendedor'
        : storedRole;

    const apellido = user.apellido ?? [
      user.apellido_paterno,
      user.apellido_materno,
    ].filter(Boolean).join(' ');

    const payload = {
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      apellido,
      correo: user.correo,
      rol,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '8h',
    });

    return response.json({
      token,
      user: payload,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;