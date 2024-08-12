import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import * as cheerio from 'cheerio'; // Import cheerio once

const app = express();

// Enable CORS for all origins
app.use(cors());

// Your Shopify store credentials
const store = '3931fc-56'; // Replace with your actual store subdomain
const apiKey = '9f021b4d77cce9c6844781c82d4b2b7d';
const password = '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';

// Create an authorization header for Shopify API
const createAuthHeader = () => {
  return 'Basic ' + Buffer.from(`${apiKey}:${password}`).toString('base64');
};

// Function to fetch data from Shopify API
const fetchFromShopify = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': createAuthHeader(),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text(); // Retrieve response body text for debugging
    throw new Error(`Failed to fetch data: ${response.statusText}. Response body: ${text}`);
  }
  return {
    data: await response.json(),
    headers: response.headers
  };
};

// Function to get products with cursor-based pagination
const getProducts = async (startingAfter = null) => {
  let url = `https://${store}.myshopify.com/admin/api/2023-01/products.json?limit=250`;
  if (startingAfter) {
    url += `&starting_after=${startingAfter}`;
  }

  const response = await fetchFromShopify(url);
  return response;
};

// Function to get product metafields
const getProductMetafields = async (productId) => {
  const url = `https://${store}.myshopify.com/admin/api/2023-01/products/${productId}/metafields.json`;
  const response = await fetchFromShopify(url);
  return response.data.metafields;
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

  const url = `https://${store}.myshopify.com/admin/api/2023-01/metafields/${metafieldId}.json`;
  const response = await fetchFromShopify(url, {
    method: 'PUT',
    body: JSON.stringify(updatePayload)
  });

  return response.data.metafield;
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

  const url = `https://${store}.myshopify.com/admin/api/2023-01/metafields.json`;
  const response = await fetchFromShopify(url, {
    method: 'POST',
    body: JSON.stringify(createPayload)
  });

  return response.data.metafield;
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
  let products = [];
  let startingAfter = null;

  while (true) {
    const { data, headers } = await getProducts(startingAfter);
    const fetchedProducts = data.products;
    if (fetchedProducts.length === 0) break;

    products = products.concat(fetchedProducts);

    // Check if there is a next page
    const linkHeader = headers.get('link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      // Extract the starting_after parameter from the link header
      const match = linkHeader.match(/starting_after=([^&]*)/);
      if (match) {
        startingAfter = match[1];
      } else {
        break;
      }
    } else {
      break;
    }
  }

  for (const product of products) {
    const metafields = await getProductMetafields(product.id);
    const specificationsMetafield = metafields.find(mf => mf.namespace === 'custom' && mf.key === 'product_specifications');
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
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
