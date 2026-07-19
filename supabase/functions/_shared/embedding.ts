export async function generateEmbedding({
    apiKey,
    apiVersion,
    endpoint,
    deployment,
    input,
}: {
    apiKey: string;
    apiVersion: string;
    endpoint: string;
    deployment: string;
    input: string;
}): Promise<number[]> {
    const request = buildEmbeddingsRequest(endpoint, apiVersion, deployment);

    const response = await fetch(request.url, {
        method: 'POST',
        headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body(input)),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Azure embedding request failed: ${errorText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data?.data) || !Array.isArray(data.data[0]?.embedding)) {
        throw new Error('Azure embedding response did not include a valid embedding vector.');
    }

    return data.data[0].embedding as number[];
}

function buildEmbeddingsUrl(endpoint: string, apiVersion: string) {
    const normalizedEndpoint = endpoint.replace(/\/+$/, '');

    if (normalizedEndpoint.endsWith('/openai/v1')) {
        return normalizedEndpoint;
    }

    return `${normalizedEndpoint}/openai/deployments`;
}

function buildEmbeddingsRequest(endpoint: string, apiVersion: string, deployment: string) {
    const normalizedBaseUrl = buildEmbeddingsUrl(endpoint, apiVersion);

    if (normalizedBaseUrl.endsWith('/openai/v1')) {
        return {
            url: `${normalizedBaseUrl}/embeddings`,
            body: (input: string) => ({
                model: deployment,
                input: [input],
            }),
        };
    }

    const encodedDeployment = encodeURIComponent(deployment);

    return {
        url: `${normalizedBaseUrl}/${encodedDeployment}/embeddings?api-version=${encodeURIComponent(apiVersion)}`,
        body: (input: string) => ({
            input: [input],
        }),
    };
}
