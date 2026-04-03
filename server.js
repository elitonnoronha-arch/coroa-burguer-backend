const express = require("express")
const cors = require("cors")
const multer = require("multer")
const path = require("path")
const http = require("http")
const { Server } = require("socket.io")

const pool = require("./db")

const app = express()
const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: "*"
  }
})

app.use(cors())
app.use(express.json())

// =============================
// PASTA UPLOADS
// =============================

app.use("/uploads", express.static(path.join(__dirname, "uploads")))

// =============================
// CONFIGURAÇÃO UPLOAD
// =============================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/")
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname))
  }
})

const upload = multer({ storage })

// =============================
// UPLOAD IMAGEM
// =============================

app.post("/upload", upload.single("imagem"), (req, res) => {

  if (!req.file) {
    return res.status(400).json({ erro: "Nenhuma imagem enviada" })
  }

  const url = `/uploads/${req.file.filename}`

  res.json({
    imagem: url
  })
})

// =============================
// LOJA STATUS
// =============================

app.get("/loja-status", async (req, res) => {

  const result = await pool.query(
    "SELECT loja_aberta FROM configuracoes LIMIT 1"
  )

  res.json(result.rows[0])
})

app.get("/pedidos", async (req, res) => {
  try {
    const pedidos = await pool.query(`
      SELECT 
        p.*,
        c.nome,
        c.endereco,
        c.telefone,
        c.forma_pagamento
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      ORDER BY p.id DESC
    `);

    // 🔥 BUSCAR ITENS DE CADA PEDIDO
    for (let pedido of pedidos.rows) {
      const itens = await pool.query(
        `SELECT * FROM itens_pedido WHERE pedido_id = $1`,
        [pedido.id]
      );

      pedido.itens = itens.rows.map(item => ({
  ...item,
  ingredientes: (() => {
    try {
      if (!item.ingredientes) return [];

      if (typeof item.ingredientes === "string") {
        if (item.ingredientes.startsWith("[")) {
          return JSON.parse(item.ingredientes);
        }
        return item.ingredientes.split(",");
      }

      return item.ingredientes;
    } catch {
      return [];
    }
  })()
}));
    }

    res.json(pedidos.rows);
  } catch (err) {
  console.error("🔥 ERRO REAL:", err.message);
  res.status(500).json({ erro: err.message });
}
});

app.get("/criar-tabela", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        nome TEXT,
        preco NUMERIC,
        imagem TEXT
      );
    `);

    res.send("Tabela criada!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao criar tabela");
  }
});

app.get("/add-produto", async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO produtos (nome, preco, imagem)
      VALUES ('X-Burguer', 15, 'https://via.placeholder.com/150')
    `);

    res.send("Produto adicionado!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao adicionar produto");
  }
});

app.post("/loja-status", async (req, res) => {

  const { aberto } = req.body

  await pool.query(
    "UPDATE configuracoes SET loja_aberta = $1",
    [aberto]
  )

  res.json({ ok: true })
})

// =============================
// PRODUTOS
// =============================

app.get("/produtos", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM produtos
      ORDER BY ordem ASC NULLS LAST, id ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

app.post("/produtos", async (req, res) => {

  const { nome, preco, imagem, categoria, ingredientes } = req.body

  const result = await pool.query(
    "INSERT INTO produtos (nome, preco, imagem, categoria, ingredientes) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [nome, preco, imagem, categoria, ingredientes]
  )

  res.json(result.rows[0])
})

app.put("/produtos/:id", async (req, res) => {
  try {

    const { id } = req.params
    const { nome, preco, categoria, imagem, ingredientes } = req.body

    const result = await pool.query(
      "UPDATE produtos SET nome=$1, preco=$2, categoria=$3, imagem=$4, ingredientes=$5 WHERE id=$6 RETURNING *",
      [nome, preco, categoria, imagem, ingredientes, id]
    )

    res.json(result.rows[0])

  } catch (erro) {

    console.error("Erro ao atualizar produto:", erro)
    res.status(500).json({ erro: "Erro ao atualizar produto" })

  }
})

app.delete("/produtos/:id", async (req, res) => {

  const { id } = req.params

  await pool.query(
    "DELETE FROM produtos WHERE id=$1",
    [id]
  )

  res.json({ ok: true })
})

app.put("/produtos/ordem", async (req, res) => {
  const { lista } = req.body;

  try {
    for (let i = 0; i < lista.length; i++) {
      await pool.query(
        "UPDATE produtos SET ordem = $1 WHERE id = $2",
        [i, lista[i].id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao ordenar" });
  }
});

// =============================
// PEDIDOS
// =============================

app.post("/pedidos", async (req, res) => {
  try {
    const { total, itens, cliente } = req.body;

    console.log("RECEBIDO:", req.body);

    // 🔴 validação
    if (!itens || itens.length === 0) {
      return res.status(400).json({ erro: "Itens não enviados" });
    }

    // 1️⃣ salvar cliente
    let cliente_id = null;

    if (cliente && cliente.nome) {
      console.log("CLIENTE RECEBIDO:", cliente);
      const resultCliente = await pool.query(
        `INSERT INTO clientes (nome, endereco, telefone, forma_pagamento)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          cliente.nome || "",
          cliente.endereco || "",
          cliente.telefone || "",
          cliente.formaPagamento || ""
        ]
      );

      cliente_id = resultCliente.rows[0].id;
    }

    // 2️⃣ salvar pedido
    const resultPedido = await pool.query(
      `INSERT INTO pedidos (total, cliente_id, status)
       VALUES ($1, $2, 'NOVO')
       RETURNING id`,
      [total, cliente_id]
    );

    const pedido_id = resultPedido.rows[0].id;

    // 3️⃣ salvar itens (AQUI ESTAVA O PROBLEMA 🔥)
    // 3️⃣ SALVAR ITENS (COM INGREDIENTES)
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
      JSON.stringify(
  item.ingredientesSelecionados || item.ingredientes || []
)
    ]
  );
}

    res.json({ sucesso: true });

  } catch (err) {
    console.error("ERRO AO SALVAR PEDIDO:", err);
    res.status(500).json({ erro: "Erro ao salvar pedido" });
  }
});



// =============================
// ATUALIZAR STATUS PEDIDO
// =============================

app.put("/pedidos/:id/status", async (req, res) => {
  try {

    const { id } = req.params
    const { status } = req.body

    await pool.query(
      "UPDATE pedidos SET status = $1 WHERE id = $2",
      [status, id]
    )

    res.json({ sucesso: true })

  } catch (erro) {

    console.error("Erro ao atualizar status:", erro)
    res.status(500).json({ erro: "Erro ao atualizar status" })

  }
})

// =============================
// EXCLUIR PEDIDO (CORRIGIDO)
// =============================

app.delete("/pedidos/:id", async (req, res) => {
  try {

    const { id } = req.params

    await pool.query(
      "DELETE FROM itens_pedido WHERE pedido_id = $1",
      [id]
    )

    await pool.query(
      "DELETE FROM pedidos WHERE id = $1",
      [id]
    )

    res.json({ sucesso: true })

  } catch (erro) {

    console.error("Erro ao excluir pedido:", erro)
    res.status(500).json({ erro: "Erro ao excluir pedido" })

  }
})

// =============================
// SOCKET
// =============================

io.on("connection", (socket) => {

  console.log("🟢 Cliente conectado:", socket.id)

})

// =============================
// SERVER
// =============================

server.listen(3001, () => {
  console.log("🚀 Servidor rodando na porta 3001")
})