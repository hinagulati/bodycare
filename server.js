import express from 'express';
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import cors from 'cors';

const app = express();

// Enable CORS for all origins
app.use(cors());

// Your Shopify store credentials
const store = '3931fc-56';
const apiKey = '9f021b4d77cce9c6844781c82d4b2b7d';
const password = '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';

// Function to get products
const getProducts = async (page = 1) => {
  const response = await fetch(`https://${apiKey}:${password}@${store}.myshopify.com/admin/api/2023-01/products.json?limit=250&page=${page}`);
  const data = await response.json();
  return data.products;
};

// Function to get product metafields
const getProductMetafields = async (productId) => {
  const response = await fetch(`https://${apiKey}:${password}@${store}.myshopify.com/admin/api/2023-01/products/${productId}/metafields.json`);
  const data = await response.json();
  return data.metafields;
};

// Function to update product metafield
const updateProductMetafield = async (metafieldId, fabricValue) => {
  const updatePayload = {
    "metafield": {
      "id": metafieldId,
      "value": fabricValue,
      "type": "single_line_text_field"
    }
  };

  const response = await fetch(`https://${apiKey}:${password}@${store}.myshopify.com/admin/api/2023-01/metafields/${metafieldId}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updatePayload)
  });

  const data = await response.json();
  return data.metafield;
};

// Function to create a new product metafield
const createProductMetafield = async (productId, fabricValue) => {
  const createPayload = {
    "metafield": {
      "namespace": "custom",
      "key": "product_fabric",
      "value": fabricValue,
      "type": "single_line_text_field",
      "owner_id": productId,
      "owner_resource": "product"
    }
  };

  const response = await fetch(`https://${apiKey}:${password}@${store}.myshopify.com/admin/api/2023-01/metafields.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createPayload)
  });

  const data = await response.json();
  return data.metafield;
};

// Function to extract fabric value from HTML content
const extractFabricValue = (htmlContent) => {
  const $ = cheerio.load(htmlContent);
  let fabric = '';

  $('#tab-attribute .attribute tbody tr').each((index, element) => {
    const cells = $(element).find('td');
    if (cells.eq(0).text() === 'Fabric') {
      fabric = cells.eq(1).text();
    }
  });

  return fabric;
};

// Function to process all products
const processProducts = async () => {
  let page = 1;
  let products = [];

  while (true) {
    const fetchedProducts = await getProducts(page);
    if (fetchedProducts.length === 0) break;
    products = products.concat(fetchedProducts);
    page++;
  }

  for (const product of products) {
    const metafields = await getProductMetafields(product.id);
    const specificationsMetafield = metafields.find(mf => mf.namespace === 'custom' && mf.key === 'specifications');
    const productFabricMetafield = metafields.find(mf => mf.namespace === 'custom' && mf.key === 'product_fabric');

    if (specificationsMetafield) {
      const fabricValue = extractFabricValue(specificationsMetafield.value);

      if (fabricValue) {
        if (productFabricMetafield) {
          await updateProductMetafield(productFabricMetafield.id, fabricValue);
          console.log(`Updated product fabric metafield for product ID ${product.id}`);
        } else {
          await createProductMetafield(product.id, fabricValue);
          console.log(`Created product fabric metafield for product ID ${product.id}`);
        }
      }
    }
  }

  console.log('All products processed successfully');
};

// Define an API endpoint to trigger the update
app.get('/api/update-product-fabric', async (req, res) => {
  try {
    await processProducts();
    res.json({ message: 'Product Fabric metafields updated successfully.' });
  } catch (error) {
    console.error('Error updating Product Fabric metafields:', error);
    res.status(500).json({ error: 'Failed to update Product Fabric metafields.' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
