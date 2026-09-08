import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { queryLecturas, listSensores } from './db.js';

function buildServer() {
  const server = new McpServer({
    name: 'sensores-aggregator-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'getLecturas',
    {
      description: 'Devuelve lecturas de sensores filtradas por sensor_id, atributo y rango de fechas (ISO8601).',
      inputSchema: {
        sensor_id: z.string().optional().describe('Identificador del sensor, ej: arduino_r3_lab_1'),
        atributo: z.string().optional().describe('Atributo a filtrar, ej: temperatura'),
        from: z.string().optional().describe('Fecha/hora inicio ISO8601'),
        to: z.string().optional().describe('Fecha/hora fin ISO8601'),
      },
    },
    async ({ sensor_id, atributo, from, to }) => {
      const data = await queryLecturas({ sensor_id, atributo, from, to });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    'listSensores',
    {
      description: 'Lista los sensor_id que han enviado datos al agregador.',
      inputSchema: {},
    },
    async () => {
      const sensores = await listSensores();
      return {
        content: [{ type: 'text', text: JSON.stringify(sensores, null, 2) }],
      };
    }
  );

  return server;
}

/** Monta el endpoint MCP (Streamable HTTP, sin estado) en /mcp sobre una app Express existente. */
export function mountMcp(app) {
  app.post('/mcp', async (req, res) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('Error MCP:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.writeHead(405).end(
      JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null })
    );
  });
}
