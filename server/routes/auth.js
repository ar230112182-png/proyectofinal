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
      `SELECT
        id_usuario,
        nombre,
        apellido_paterno,
        apellido_materno,
        correo,
        password,
        rol
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

    let passwordValid = false;

    if (user.password?.startsWith('$2')) {
      passwordValid = await bcrypt.compare(contrasena, user.password);
    } else {
      passwordValid = user.password === contrasena;

      if (passwordValid) {
        const passwordHash = await bcrypt.hash(contrasena, 12);

        await pool.query(
          `UPDATE public.usuarios
           SET password = $1
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

    const rol = user.rol === 'admin'
      ? 'administrador'
      : user.rol;

    const apellido = [
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