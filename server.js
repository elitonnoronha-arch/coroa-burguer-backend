const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const pool = require("./db");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// =============================
// CONTROLE DE VISITAS
// =============================


/*let visitantes = {}; */ 

app.use(cors());
app.use(express.json());


const visitas = {}

app.post("/visitas/ping", (req, res) => {
  const id = req.ip || Math.random().toString()

  if (!visitas[id]) {
    visitas[id] = {
      inicio: Date.now(),
      tempo: 0,
      ativo: true
    }
  }

  visitas[id].ultimoPing = Date.now()
  visitas[id].ativo = true

  res.sendStatus(200)
})

setInterval(() => {
  const agora = Date.now()

  Object.values(visitas).forEach((v) => {

    // 🔴 se passou muito tempo sem ping → offline
    if (agora - v.ultimoPing > 10000) {
      v.ativo = false
    }

    // ✅ só conta tempo se estiver online
    if (v.ativo) {
      v.tempo += 1
    }

  })
}, 1000)

// =============================
// UPLOADS
// =============================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Apenas imagens são permitidas"));
  }
});

// =============================
// ROTAS
// =============================

// Upload
app.post("/upload", upload.single("imagem"), (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ erro: "Nenhuma imagem enviada" });

    const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ imagem: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro no upload" });
  }
});

app.post("/visita/inicio", (req, res) => {
  const id = Date.now().toString();

  visitantes[id] = {
    inicio: new Date(),
    ativo: true
  };

  res.json({ id });
});

app.get("/visitas", (req, res) => {
  const agora = Date.now();

  const dados = Object.fromEntries(
    Object.entries(visitas).map(([id, v]) => [
      id,
      {
        ativo: v.ativo,
        tempo: (agora - v.inicio) / 1000
      }
    ])
  );

  res.json(dados);
});

//CRIA ROTA: visitante entrou

app.post("/visita/inicio", (req, res) => {
  const id = Date.now().toString();

  visitantes[id] = {
    inicio: new Date(),
    ativo: true
  };

  res.json({ id });
});

//CRIA ROTA: visitante saiu

app.post("/visita/fim", (req, res) => {
  const { id } = req.body;

  if (visitantes[id]) {
    visitantes[id].fim = new Date();
    visitantes[id].ativo = false;

    const tempo =
      (visitantes[id].fim - visitantes[id].inicio) / 1000;

    visitantes[id].tempo = tempo;
  }

  res.json({ ok: true });
});

//ROTA PRA VER DADOS (ADMIN)

app.get("/visitas", (req, res) => {
  const agora = Date.now();

  const visitasComTempo = {};

  for (const id in visitas) {
    const visita = visitas[id];

    visitasComTempo[id] = {
      ...visita,
      tempo: (agora - visita.inicio) / 1000 // tempo em segundos
    };
  }

  res.json(visitasComTempo);
});


// =============================
// STATUS DA LOJA (SEGURO)
// =============================
app.get("/loja-status", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT loja_aberta FROM configuracoes LIMIT 1"
    );

    // Se não tiver nada no banco
    if (result.rows.length === 0) {
      return res.json({ loja_aberta: true });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro loja-status:", err);

    // NÃO quebra o sistema
    res.json({ loja_aberta: true });
  }
});

app.post("/loja-status", async (req, res) => {
  try {
    const { aberto } = req.body;

    await pool.query(
      "UPDATE configuracoes SET loja_aberta = $1",
      [aberto]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("Erro ao atualizar loja:", err);
    res.status(500).json({ erro: "Erro ao atualizar status" });
  }
});

// =============================
// LOJA
// =============================

/* app.get("/loja-status", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT loja_aberta FROM configuracoes LIMIT 1"
    );

    res.json(result.rows[0] || { loja_aberta: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar status da loja" });
  }
}); */

app.post("/loja-status", async (req, res) => {
  try {
    const { aberto } = req.body;

    await pool.query(
      "UPDATE configuracoes SET loja_aberta = $1",
      [aberto]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar status" });
  }
});

// =============================
// PRODUTOS
// =============================
/* app.get("/produtos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM produtos ORDER BY ordem ASC NULLS LAST, id ASC"
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
}); */

app.get("/produtos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM produtos ORDER BY ordem ASC NULLS LAST, id ASC"
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error("ERRO /produtos:", err);
    res.status(500).json({ erro: err.message });
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
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar produto" });
  }
});

app.put("/produtos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, preco, categoria, imagem, ingredientes } = req.body;

    const result = await pool.query(
      `UPDATE produtos 
       SET nome=$1, preco=$2, categoria=$3, imagem=$4, ingredientes=$5 
       WHERE id=$6 RETURNING *`,
      [nome, preco, categoria, imagem, ingredientes, id]
    );

    res.json(result.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao atualizar produto" });
  }
});

app.delete("/produtos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM produtos WHERE id=$1", [id]);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao deletar produto" });
  }
});

// ORDEM (DRAG)
app.put("/produtos/ordem", async (req, res) => {
  try {
    const { lista } = req.body;

    for (let i = 0; i < lista.length; i++) {
      await pool.query(
        "UPDATE produtos SET ordem = $1 WHERE id = $2",
        [i, lista[i].id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao ordenar produtos" });
  }
});

// =============================
// PEDIDOS
// =============================
app.get("/pedidos", async (req, res) => {
  try {
    const pedidos = await pool.query(`
      SELECT p.*, c.nome, c.endereco, c.telefone, c.forma_pagamento
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      ORDER BY p.id DESC
    `);

    const pedidosComItens = await Promise.all(
      pedidos.rows.map(async (pedido) => {
        const itens = await pool.query(
          "SELECT * FROM itens_pedido WHERE pedido_id = $1",
          [pedido.id]
        );

        pedido.itens = itens.rows.map((item) => ({
          ...item,
          ingredientes: (() => {
            try {
              if (!item.ingredientes) return [];

              if (typeof item.ingredientes === "string") {
                if (item.ingredientes.startsWith("["))
                  return JSON.parse(item.ingredientes);

                return item.ingredientes.split(",");
              }

              return item.ingredientes;
            } catch {
              return [];
            }
          })()
        }));

        return pedido;
      })
    );

    res.json(pedidosComItens);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar pedidos" });
  }
});

app.post("/pedidos", async (req, res) => {
  try {
    const { total, itens, cliente } = req.body;

    if (!itens || itens.length === 0)
      return res.status(400).json({ erro: "Itens não enviados" });

    let cliente_id = null;

    if (cliente && cliente.nome) {
      const resultCliente = await pool.query(
        `INSERT INTO clientes 
        (nome, endereco, telefone, forma_pagamento)
        VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          cliente.nome || "",
          cliente.endereco || "",
          cliente.telefone || "",
          cliente.formaPagamento || ""
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
          JSON.stringify(
            item.ingredientesSelecionados ||
              item.ingredientes ||
              []
          )
        ]
      );
    }

    io.emit("novo-pedido", { pedido_id, total, cliente });

    res.json({ sucesso: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar pedido" });
  }
});

app.put("/pedidos/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await pool.query(
      "UPDATE pedidos SET status = $1 WHERE id = $2",
      [status, id]
    );

    res.json({ sucesso: true });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao atualizar status" });
  }
});

app.delete("/pedidos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      "DELETE FROM itens_pedido WHERE pedido_id = $1",
      [id]
    );

    await pool.query(
      "DELETE FROM pedidos WHERE id = $1",
      [id]
    );

    res.json({ sucesso: true });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao excluir pedido" });
  }
});

// =============================
// SOCKET
// =============================
io.on("connection", socket => {
  console.log("🟢 Cliente conectado:", socket.id);

  // Quando entra
  visitas[socket.id] = {
    inicio: Date.now(),
    ativo: true
  };

  // Quando sai
  socket.on("disconnect", () => {
    if (visitas[socket.id]) {
      visitas[socket.id].ativo = false;
    }
  });
});




// =============================
// SERVER
// =============================
const PORT = process.env.PORT || 3001;

// =============================
// VISITANTES (ANALYTICS)
// =============================

let visitantes = {};

// visitante entrou
app.post("/visita/inicio", (req, res) => {
  const id = Date.now().toString();

  visitantes[id] = {
    inicio: new Date(),
    ativo: true
  };

  console.log("🟢 Visitante entrou:", id);

  res.json({ id });
});

// visitante saiu
app.post("/visita/fim", (req, res) => {
  const { id } = req.body;

  if (visitantes[id]) {
    visitantes[id].fim = new Date();
    visitantes[id].ativo = false;

    const tempo = (visitantes[id].fim - visitantes[id].inicio) / 1000;
    visitantes[id].tempo = tempo;

    console.log("🔴 Visitante saiu:", id, "Tempo:", tempo);
  }

  res.json({ ok: true });
});

// listar visitas
app.get("/visitas", (req, res) => {
  res.json(visitantes);
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});