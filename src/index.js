// src/index.js 
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; 
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'; 
import { z } from 'zod'; 
 
// Base URL of the running Product Management API 
const API_BASE = process.env.PRODUCT_API_URL ?? 'http://localhost:3000'; 
 
// Helper: make a request to the Product API 
async function apiRequest(method, path, body) { 
  const options = { 
    method, 
    headers: { 'Content-Type': 'application/json' }, 
  }; 
  if (body) options.body = JSON.stringify(body); 
  const res = await fetch(`${API_BASE}${path}`, options); 
  return res.json(); 
} 
 
// Initialise the MCP server 
const server = new McpServer({ 
  name: 'product-mcp-server', 
  version: '1.0.0', 
}); 
 
// ── Tools, Resources, Prompts registered below ── 
 server.registerTool( 
  'list_products', 
  { 
    description: 
      'List products from the catalogue. Accepts optional filters: ' + 
      'category (electronics|clothing|food|books|other), ' + 
      'status (active|inactive|discontinued), ' + 
      'minPrice, maxPrice, inStock (true/false), search (text).', 
    inputSchema: { 
      category: 
z.enum(['electronics','clothing','food','books','other']).optional(), 
      status:   z.enum(['active','inactive','discontinued']).optional(), 
      minPrice: z.number().positive().optional(), 
      maxPrice: z.number().positive().optional(), 
      inStock:  z.boolean().optional(), 
      search:   z.string().optional(), 
    }, 
  }, 
  async (params) => { 
    const qs = new URLSearchParams(); 
    for (const [k, v] of Object.entries(params)) { 
      if (v !== undefined) qs.set(k, String(v)); 
    } 
    const result = await apiRequest('GET', `/products?${qs}`); 
    return { 
      content: [{ type: 'text', 
        text: JSON.stringify(result, null, 2) }], 
    }; 
  } 
); 

server.registerTool( 
  'create_product', 
  { 
    description: 
      'Create a new product in the catalogue. ' + 
      'Returns the created product including its generated id and createdAt timestamp.', 
    inputSchema: { 
      name:        z.string().min(1).max(150), 
      sku:         z.string().regex(/^[A-Z0-9-]{3,20}$/), 
      description: z.string().optional(), 
      category:    z.enum(['electronics','clothing','food','books','other']), 
      price:       z.number().positive(), 
      stock:       z.number().int().nonnegative(), 
      status:      z.enum(['active','inactive','discontinued']).optional(), 
    }, 
  }, 
  async (product) => { 
    const result = await apiRequest('POST', '/products', product); 
    const success = result.success 
      ? `Product created:\n${JSON.stringify(result.data, null, 2)}` 
      : `Error: ${result.error}`; 
    return { content: [{ type: 'text', text: success }] }; 
  } 
);


import { execFile } from 'child_process'; 
import { promisify } from 'util'; 
const execFileAsync = promisify(execFile); 
server.registerTool( 
  'run_tests', 
  { 
    description: 
      'Run the Product Management API test suite using npm test. ' + 
      'Returns pass/fail counts and any error messages. ' + 
      'Use this after making code changes to verify nothing is broken.', 
    inputSchema: { 
      coverage: z.boolean().optional().describe( 
        'Set true to run with --experimental-test-coverage'), 
    }, 
  }, 
  async ({ coverage }) => { 
    const script = coverage ? 'test:coverage' : 'test'; 
    const apiDir = process.env.PRODUCT_API_DIR 
      ?? '../product-management-api'; 
    try { 
      const { stdout, stderr } = await execFileAsync( 
        'npm', ['run', script], 
        { cwd: apiDir, timeout: 60_000 } 
      ); 
      return { content: [{ type: 'text', 
        text: stdout || stderr }] }; 
    } catch (err) { 
      return { content: [{ type: 'text', 
        text: `Tests failed:\n${err.stdout}\n${err.stderr}` }] }; 
    } 
  } 
);

server.registerResource( 
  'catalogue', 
  'product://catalogue', 
  { 
    name:        'Product Catalogue', 
    description: 'Live snapshot of all active (non-archived) products in the API.', 
    mimeType:    'application/json', 
  }, 
  async (uri) => { 
    const result = await apiRequest('GET', '/products?status=active'); 
    return { 
      contents: [{ 
        uri: uri.href, 
        mimeType: 'application/json', 
        text: JSON.stringify(result.data ?? result, null, 2), 
      }], 
    }; 
  } 
);

import { readFile } from 'fs/promises'; 
import { resolve, dirname } from 'path'; 
import { fileURLToPath } from 'url'; 
 
const __dirname = dirname(fileURLToPath(import.meta.url)); 
 
server.registerResource( 
  'openapi', 
  'product://openapi', 
  { 
    name:        'OpenAPI Specification', 
    description: 'The OpenAPI 3.1 specification for the Product Management API.', 
    mimeType:    'application/yaml', 
  }, 
  async (uri) => { 
    const specPath = resolve(__dirname, 
      '../../product-management-api/docs/openapi.yaml'); 
    const text = await readFile(specPath, 'utf8'); 
return { 
      contents: [{ 
        uri: uri.href, 
        mimeType: 'application/yaml', 
        text, 
      }], 
    }; 
  } 
);

server.registerPrompt( 
  'review_product_schema', 
  { 
    name:        'Review Product Schema', 
    description: 'Prompt Claude to review the product model for consistency ' + 
                 'between the in-memory store, validators, and the OpenAPI spec.', 
    arguments: [], 
  }, 
  async () => { 
    return { 
      messages: [{ 
        role: 'user', 
        content: { 
          type: 'text', 
          text: [ 
            'Review the Product Management API for schema consistency.', 
            '', 
            'Check these three sources and report any discrepancies:', 
            '1. src/models/product.js — the in-memory data model', 
            '2. src/validators/productValidator.js — the express-validator rules', 
            '3. docs/openapi.yaml — the OpenAPI 3.1 specification', 
            '', 
            'For each field (id, name, sku, description, category, price,', 
            'stock, status, createdAt, archivedAt) verify:', 
            '  - The field exists in all three sources', 
            '  - The type and constraints match across sources', 
            '  - Required vs optional is consistent', 
            '', 
            'Format the output as a table: Field | Model | Validator | OpenAPI | Status', 
          ].join('\n'), 
        }, 
      }], 
    }; 
  } 
);

server.registerPrompt( 
  'seed_test_data', 
  { 
    name:        'Seed Test Data', 
    description: 'Prompt Claude to create a realistic set of products ' + 
                 'covering all categories and edge cases for manual testing.', 
    arguments: [ 
      { 
        name:        'count', 
        description: 'Number of products to create (default 10)', 
        required:    false, 
      }, 
    ], 
  }, 
  async ({ count }) => { 
    const n = parseInt(count ?? '10', 10); 
    return { 
      messages: [{ 
        role: 'user', 
        content: { 
          type: 'text', 
          text: [ 
            `Create ${n} realistic products using the create_product tool.`, 
            '', 
            'Requirements:', 
            '- Cover all five categories: electronics, clothing, food, books, other', 
            '- Include products with status: active, inactive, and discontinued', 
            '- Include at least one product with stock = 0 (out of stock)', 
            '- Include at least one product with a long description (100+ characters)', 
            '- Use realistic names and SKUs in format CATEGORY-NNN', 
            '- Prices should range from under $10 to over $500', 
            '', 
            'Create all products one at a time using the create_product tool.', 
            'Report a summary table when done: Name | SKU | Category | Price | Stock', 
          ].join('\n'), 
        }, 
      }], 
    }; 
  } 
); 
// Start the server on stdio 
async function main() { 
  const transport = new StdioServerTransport(); 
  await server.connect(transport); 

   console.error('product-mcp-server running on stdio'); 
} 
 
main().catch(err => { 
  console.error('Fatal error:', err); 
  process.exit(1); 
});