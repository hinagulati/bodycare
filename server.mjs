import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import * as cheerio from 'cheerio';

const app = express();
app.use(cors());

// Shopify store credentials
const store = '3931fc-56';
const apiKey = '9f021b4d77cce9c6844781c82d4b2b7d';
const password = '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';

const createAuthHeader = () => {
  return 'Basic ' + Buffer.from(`${apiKey}:${password}`).toString('base64');
};

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

    const text = await response.text();
    if (!response.ok) {
      if (response.status === 429) {
        console.warn('Rate limit exceeded. Retrying after 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchFromShopify(url, options);
      }
      throw new Error(`Failed to fetch data: ${response.statusText}. Response body: ${text}`);
    }

    return {
      data: JSON.parse(text),
      headers: response.headers,
      links: response.headers.get('link') // Fetch link headers for pagination
    };
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
};

const getProducts = async (limit = 250, pageInfo = null) => {
  let url = `https://${store}.myshopify.com/admin/api/2023-01/products.json?limit=${limit}`;
  if (pageInfo) {
    url += `&page_info=${pageInfo}`;
  }
  const response = await fetchFromShopify(url);
  return response;
};

const getProductMetafields = async (productId) => {
  const url = `https://${store}.myshopify.com/admin/api/2023-01/products/${productId}/metafields.json`;
  const response = await fetchFromShopify(url);
  return response.data.metafields;
};

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

    return response.data.metafield;
  } catch (error) {
    console.error('Error updating metafield:', error);
    throw error;
  }
};

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

    return response.data.metafield;
  } catch (error) {
    console.error('Error creating metafield:', error);
    throw error;
  }
};

const extractFabricValue = (htmlContent) => {
  const $ = cheerio.load(htmlContent);
  let fabric = '';

  $('table.attribute tbody tr').each((index, element) => {
    const cells = $(element).find('td');
    if (cells.eq(0).text().trim() === 'Fabric') {
      fabric = cells.eq(1).text().trim();
    }
  });

  return fabric;
};

const getNextPageInfo = (linkHeader) => {
  if (!linkHeader) return null;

  const links = linkHeader.split(',').map(link => link.trim());
  const nextLink = links.find(link => link.includes('rel="next"'));

  if (nextLink) {
    const match = nextLink.match(/<(.*?)>/);
    if (match) {
      const url = new URL(match[1]);
      return url.searchParams.get('page_info');
    }
  }

  return null;
};

const processProductsBatch = async (batchSize, pageInfo = null) => {
  let processedCount = 0;
  let hasMoreProducts = true;

  while (hasMoreProducts) {
    console.log(`Processing batch...`);
    try {
      const { data, links } = await getProducts(batchSize, pageInfo);
      const products = data.products;

      if (products.length === 0) {
        hasMoreProducts = false;
        break;
      }

      for (const product of products) {
        if (processedCount >= batchSize) {
          hasMoreProducts = false;
          break;
        }

        const metafields = await getProductMetafields(product.id);
        const specificationsMetafield = metafields.find(mf => mf.namespace === 'custom' && mf.key === 'product_specifications');
        const productFabricMetafield = metafields.find(mf => mf.namespace === 'custom' && mf.key === 'product_fabric');

        if (specificationsMetafield) {
          const fabricValue = extractFabricValue(specificationsMetafield.value);
          console.log("fabricValue:", fabricValue);

          if (fabricValue && fabricValue.trim() !== "") {
            if (productFabricMetafield) {
              await updateProductMetafield(productFabricMetafield.id, fabricValue);
              console.log(`Updated product fabric metafield for product ID ${product.id} (Title: ${product.title})`);
            } else {
              await createProductMetafield(product.id, fabricValue);
              console.log(`Created product fabric metafield for product ID ${product.id} (Title: ${product.title})`);
            }
          } else {
            console.log(`Skipping product ID ${product.id} (Title: ${product.title}) due to empty fabricValue.`);
          }
        }

        processedCount++;

        const apiCallLimit = links.get('X-Shopify-Shop-Api-Call-Limit');
        if (apiCallLimit) {
          const [usedCalls, maxCalls] = apiCallLimit.split('/').map(Number);
          if (usedCalls >= maxCalls - 2) {
            console.warn('Approaching rate limit. Waiting for 2 seconds...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      // Check for next page
      pageInfo = getNextPageInfo(links);
      if (!pageInfo) {
        hasMoreProducts = false;
      }
    } catch (error) {
      console.error('Error processing products:', error);
      hasMoreProducts = false;
    }
  }

  console.log(`Processed ${processedCount} products successfully.`);
};

app.get('/api/update-product-fabric', async (req, res) => {
  const batchSize = parseInt(req.query.batchSize, 10) || 250;
  const pageInfo = req.query.page || null;

  try {
    await processProductsBatch(batchSize, pageInfo);
    res.json({ message: `Product Fabric metafields updated successfully for batch size of ${batchSize}.`, pageInfo: pageInfo });
  } catch (error) {
    console.error('Error updating product fabric:', error);
    res.status(500).json({ error: 'Error updating product fabric' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
