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
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': createAuthHeader(),
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const text = await response.text(); // Read the response text
    if (!response.ok) {
      if (response.status === 429) {
        console.warn('Rate limit exceeded. Retrying after 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchFromShopify(url, options); // Retry the request
      }
      throw new Error(`Failed to fetch data: ${response.statusText}. Response body: ${text}`);
    }

    return {
      data: JSON.parse(text),
      headers: response.headers
    };
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
};

// Function to get products with cursor-based pagination
const getProducts = async (lastProductId = null, limit = 50) => {
  let url = `https://${store}.myshopify.com/admin/api/2023-01/products.json?limit=${limit}`;
  if (lastProductId) {
    url += `&since_id=${lastProductId}`;
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
  try {
    const response = await fetchFromShopify(url, {
      method: 'PUT',
      body: JSON.stringify(updatePayload)
    });

    console.log('Update response:', response.data); // Log the update response
    return response.data.metafield;
  } catch (error) {
    console.error('Error updating metafield:', error);
    throw error;
  }
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
  try {
    const response = await fetchFromShopify(url, {
      method: 'POST',
      body: JSON.stringify(createPayload)
    });

    console.log('Create response:', response.data); // Log the create response
    return response.data.metafield;
  } catch (error) {
    console.error('Error creating metafield:', error);
    throw error;
  }
};

// Function to extract fabric value from HTML content
const extractFabricValue = (htmlContent) => {
  const $ = cheerio.load(htmlContent);
  let fabric = '';

  // Adjusted selector to match the structure provided
  $('table.attribute tbody tr').each((index, element) => {
    const cells = $(element).find('td');
    if (cells.eq(0).text().trim() === 'Fabric') {
      fabric = cells.eq(1).text().trim();
    }
  });

  return fabric;
};


// Function to process a batch of products
const processProducts = async (limit = 500) => {
  let processedCount = 0;
  let hasMoreProducts = true;
  let lastProductId = null;
  const processedProductIds = []; // Array to store processed product IDs

  while (hasMoreProducts && processedCount < limit) {
    console.log("More products");
    try {
      const { data, headers } = await getProducts(lastProductId, limit);
      const products = data.products;

      for (const product of products) {
        if (processedCount >= limit) {
          hasMoreProducts = false;
          break;
        }

        const metafields = await getProductMetafields(product.id);
        const specificationsMetafield = metafields.find(mf => mf.namespace === 'custom' && mf.key === 'product_specifications');
        const productFabricMetafield = metafields.find(mf => mf.namespace === 'custom' && mf.key === 'product_fabric');
 console.log(specificationsMetafield);
      if (specificationsMetafield) {
    const fabricValue = extractFabricValue(specificationsMetafield.value);
    console.log("fabricValue:", fabricValue);

    if (fabricValue && fabricValue.trim() !== "") {
        if (productFabricMetafield) {
            console.log("Updating productFabricMetafield");
            await updateProductMetafield(productFabricMetafield.id, fabricValue);
            console.log(`Updated product fabric metafield for product ID ${product.id} (Title: ${product.title})`);
        } else {
            console.log("Creating productFabricMetafield");
            await createProductMetafield(product.id, fabricValue);
            console.log(`Created product fabric metafield for product ID ${product.id} (Title: ${product.title})`);
        }
    } else {
        console.log(`Skipping product ID ${product.id} (Title: ${product.title}) due to empty fabricValue.`);
    }
}

        // Log the processed product ID and title
        processedProductIds.push({ id: product.id, title: product.title });
        processedCount++;

        // Handling rate limiting by checking Shopify's API call limits
        const apiCallLimit = headers.get('X-Shopify-Shop-Api-Call-Limit');
        if (apiCallLimit) {
          const [usedCalls, maxCalls] = apiCallLimit.split('/').map(Number);
          if (usedCalls >= maxCalls - 2) {
            console.warn('Approaching rate limit. Waiting for 2 seconds...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      // Check if there are more products to process
      const linkHeader = headers.get('link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        lastProductId = products[products.length - 1].id;
      } else {
        hasMoreProducts = false;
      }
    } catch (error) {
      console.error('Error processing products:', error);
      hasMoreProducts = false;
    }
  }

  // Log the list of processed products
  console.log(`Processed ${processedCount} products successfully. Product details:`);
  processedProductIds.forEach(product => {
    console.log(`ID: ${product.id}, Title: ${product.title}`);
  });
};

// Define an API endpoint to trigger the update for a specific number of products
app.get('/api/update-product-fabric', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 500; // Default to 50 products if not specified

  try {
    await processProducts(limit);
    res.json({ message: `Product Fabric metafields updated successfully for ${limit} products.` });
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
