import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import * as cheerio from 'cheerio';

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

// Function to fetch data from Shopify API with rate limiting
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
    if (response.status === 429) {
      // Handle rate limiting error by retrying after a delay
      console.warn('Rate limit exceeded. Retrying after 1 second...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchFromShopify(url, options); // Retry the request
    }
    throw new Error(`Failed to fetch data: ${response.statusText}. Response body: ${text}`);
  }

  return response.json();
};

// Function to get products with pagination
const getProducts = async (page = 1) => {
  const url = `https://${store}.myshopify.com/admin/api/2023-01/products.json?limit=250&page=${page}`;
  return fetchFromShopify(url);
};

// Function to get product metafields
const getProductMetafields = async (productId) => {
  const url = `https://${store}.myshopify.com/admin/api/2023-01/products/${productId}/metafields.json`;
  return fetchFromShopify(url);
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
  return fetchFromShopify(url, {
    method: 'PUT',
    body: JSON.stringify(updatePayload)
  });
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
  return fetchFromShopify(url, {
    method: 'POST',
    body: JSON.stringify(createPayload)
  });
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

// Function to process products in batches
const processProducts = async () => {
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const { products } = await getProducts(page);

    if (products.length === 0) {
      hasMore = false;
    } else {
      for (const product of products) {
        try {
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
        } catch (error) {
          console.error(`Error processing product ID ${product.id}:`, error);
        }
      }

      page++;
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
