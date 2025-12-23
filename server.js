require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de CORS - permite localhost y dominios de producción
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.FRONTEND_URL, // URL de producción desde variable de entorno
].filter(Boolean); // Elimina valores undefined

app.use(
  cors({
    origin: function (origin, callback) {
      // Permitir requests sin origin (como mobile apps o curl)
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.indexOf(origin) !== -1 ||
        allowedOrigins.some((allowed) => origin?.includes(allowed))
      ) {
        callback(null, true);
      } else {
        console.log("Origen bloqueado por CORS:", origin);
        callback(new Error("No permitido por CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json());

let twitchAccessToken = null;

const getAppAccessToken = async () => {
  try {
    const response = await axios.post(
      "https://id.twitch.tv/oauth2/token",
      null,
      {
        params: {
          client_id: process.env.TWITCH_CLIENT_ID,
          client_secret: process.env.TWITCH_CLIENT_SECRET,
          grant_type: "client_credentials",
        },
      }
    );
    twitchAccessToken = response.data.access_token;
    console.log("Token de Twitch obtenido exitosamente.");
  } catch (error) {
    console.error(
      "ERROR AL OBTENER TOKEN DE TWITCH:",
      error.response ? error.response.data : error.message
    );
    twitchAccessToken = null;
    throw new Error(
      "Fallo en la autenticación de Twitch: Revise las credenciales en .env"
    );
  }
};

app.get("/api/twitch/streams", async (req, res) => {
  if (!twitchAccessToken) {
    try {
      await getAppAccessToken();
    } catch (e) {}

    if (!twitchAccessToken) {
      return res.status(503).json({
        error:
          "No se pudo obtener el token de Twitch. Intente reiniciar el servidor.",
      });
    }
  }

  try {
    const streamsResponse = await axios.get(
      "https://api.twitch.tv/helix/streams",
      {
        params: {
          first: 10,
          language: "es", // Streams en español
        },
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${twitchAccessToken}`,
        },
      }
    );

    const rawStreams = streamsResponse.data.data;
    const userIds = rawStreams.map((stream) => stream.user_id);

    if (userIds.length === 0) {
      return res.json([]);
    }

    const usersResponse = await axios.get("https://api.twitch.tv/helix/users", {
      params: {
        id: userIds,
      },
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitchAccessToken}`,
      },
    });

    const userMap = usersResponse.data.data.reduce((map, user) => {
      map[user.id] = user;
      return map;
    }, {});

    const combinedData = rawStreams.map((stream) => {
      const userDetails = userMap[stream.user_id];
      return {
        id: stream.id,
        canal: stream.user_name,
        titulo: stream.title,
        categoria: stream.game_name,
        avatarUrl: userDetails ? userDetails.profile_image_url : null,
        espectadores: stream.viewer_count,
        enVivo: stream.type === "live",
        imagen: stream.thumbnail_url
          .replace("{width}", "440")
          .replace("{height}", "248"),
      };
    });

    res.json(combinedData);
  } catch (error) {
    console.error(
      "Error al obtener los streams de Helix (solicitud fallida):",
      error.response ? error.response.data : error.message
    );
    res
      .status(500)
      .json({ error: "Fallo interno al obtener streams de Twitch." });
  }
});

app.post("/auth/twitch/callback", async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res
      .status(400)
      .json({ error: "No se encontró el código de autorización." });
  }

  try {
    const tokenResponse = await axios.post(
      "https://id.twitch.tv/oauth2/token",
      null,
      {
        params: {
          client_id: process.env.TWITCH_CLIENT_ID,
          client_secret: process.env.TWITCH_CLIENT_SECRET,
          code: code,
          grant_type: "authorization_code",
          redirect_uri:
            process.env.TWITCH_REDIRECT_URI ||
            "http://localhost:5173/auth/twitch",
        },
      }
    );

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get("https://api.twitch.tv/helix/users", {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${access_token}`,
      },
    });

    const userData = userResponse.data.data[0];

    res.json({
      success: true,
      user: {
        id: userData.id,
        name: userData.display_name,
        profile_image_url: userData.profile_image_url,
      },
      access_token,
    });
  } catch (error) {
    console.error(
      "Error al intercambiar código:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Fallo en la autenticación con Twitch." });
  }
});

// -----------------------------------------------------------
// C. INICIALIZACIÓN DEL SERVIDOR
// -----------------------------------------------------------
const initializeServer = async () => {
  try {
    await getAppAccessToken();
  } catch (e) {
    console.error(
      "El servidor no pudo inicializar con el token de Twitch. Revisar .env."
    );
  }

  app.listen(PORT, () => {
    console.log(`Servidor intermedio corriendo en http://localhost:${PORT}`);
  });
};

initializeServer();
