require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Readable } = require("stream");
const http = require("http");
const { Server } = require("socket.io");
const cloudinary = require("cloudinary").v2;
const pool = require("./db");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// =============================
// CONFIG CLOUDINARY (.env)
// =============================
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// =============================
// MIDDLEWARE
// =============================
app.use(cors());
app.use(express.json());

// =============================
// UPLOAD (SEM BUG)
// =============================
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Apenas imagens são permitidas"));
  }
});

// Upload para Cloudinary
app.post("/upload", upload.single("imagem"), async (req, res) => {
  try {
    const streamUpload = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "coroa-burger" },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );

        Readable.from(req.file.buffer).pipe(stream);
      });
    };

    const result = await streamUpload();

    res.json({
      imagem: result.secure_url
    });

  } catch (err) {
    console.error("ERRO UPLOAD:", err);
    res.status(500).json({ erro: "Erro no upload" });
  }
});

// =============================
// PRODUTOS
// =============================
app.get("/produtos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM produtos ORDER BY ordem ASC NULLS LAST, id ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
});

app.get("/pedidos", async (req, res) => {
  try {
    const pedidos = await pool.query("SELECT * FROM pedidos ORDER BY id DESC");
    res.json(pedidos.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar pedidos" });
  }
});

app.post("/produtos", async (req, res) => {
  try {
    const { nome, preco, imagem, categoria, ingredientes } = req.body;

    const result = await pool.query(
      `INSERT INTO produtos 
      (nome, preco, imagem, categoria, ingredientes) 
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nome, preco, imagem, categoria, ingredientes]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao criar produto" });
  }
});

// =============================
// PEDIDOS
// =============================
app.post("/pedidos", async (req, res) => {
  try {
    const { total, itens, cliente } = req.body;

    if (!itens || itens.length === 0) {
      return res.status(400).json({ erro: "Itens não enviados" });
    }

    let cliente_id = null;

    if (cliente && cliente.nome) {
      const resultCliente = await pool.query(
        `INSERT INTO clientes 
        (nome, endereco, telefone, forma_pagamento)
        VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          cliente.nome,
          cliente.endereco,
          cliente.telefone,
          cliente.formaPagamento
        ]
      );

      cliente_id = resultCliente.rows[0].id;
    }

    const resultPedido = await pool.query(
      `INSERT INTO pedidos 
      (total, cliente_id, status) 
      VALUES ($1, $2, 'NOVO') RETURNING id`,
      [total, cliente_id]
    );

    const pedido_id = resultPedido.rows[0].id;

    for (const item of itens) {
      await pool.query(
        `INSERT INTO itens_pedido 
        (pedido_id, nome, quantidade, preco, ingredientes)
        VALUES ($1, $2, $3, $4, $5)`,
        [
          pedido_id,
          item.nome,
          item.quantidade,
          item.preco,
          JSON.stringify(item.ingredientes || [])
        ]
      );
    }

    io.emit("novo-pedido", { pedido_id });

    res.json({ sucesso: true, id: pedido_id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar pedido" });
  }
});

// =============================
// MERCADO PAGO
// =============================
const mercadopago = require("mercadopago");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

app.post("/criar-pagamento", async (req, res) => {
  try {
    const { itens, email, pedido_id } = req.body;

    const preference = {
      items: itens.map(item => ({
        title: item.nome,
        unit_price: Number(item.preco),
        quantity: Number(item.quantidade),
        currency_id: "BRL"
      })),
      payer: {
        email: email || "teste@email.com"
      },
      external_reference: String(pedido_id)
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      link: response.body.init_point
    });

  } catch (error) {
    console.error("ERRO PAGAMENTO:", error);
    res.status(500).json({ erro: "Erro ao criar pagamento" });
  }
});

// =============================
// SOCKET.IO
// =============================
io.on("connection", socket => {
  console.log("Cliente conectado:", socket.id);
});

// =============================
// TESTE
// =============================
app.get("/", (req, res) => {
  res.send("API rodando 🚀");
});

// =============================
// START
// =============================
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});