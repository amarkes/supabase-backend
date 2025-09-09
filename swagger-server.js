const express = require('express');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Ler o arquivo swagger.yaml
const swaggerDocument = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger.yaml'), 'utf8'));

// Servir o Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Rota raiz
app.get('/', (req, res) => {
  res.send(`
    <h1>Supabase Users API</h1>
    <p>Documentação disponível em: <a href="/api-docs">/api-docs</a></p>
    <p>URL da API: <code>https://hlcjecnmvqjabammbdly.supabase.co/functions/v1/users</code></p>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Swagger rodando em: http://localhost:${PORT}`);
  console.log(`📚 Documentação em: http://localhost:${PORT}/api-docs`);
});
