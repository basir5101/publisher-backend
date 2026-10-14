import dotenv from 'dotenv';

dotenv.config();

import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
    region: process.env.AWS_REGION || "auto",
    endpoint: process.env.AWS_ENDPOINT,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

export async function getR2Rd(key) {
    try {
        const command = new GetObjectCommand({
            Bucket: getR2Bucket("rd"),
            Key: key,
        });

        const response = await s3.send(command);

        // AWS SDK v3 returns a stream for the Body.
        // The .transformToString() method makes it easy to read as text.
        let rdContent = await response.Body.transformToString();

        // Keep your existing logic to strip out the specific script tag
        rdContent = rdContent.replace(
            /<script>\(function\(\)\{function c\(\).*?<\/script>/s,
            "",
        );

        console.log("R2 content", rdContent)
        return {
            success: true,
            data: rdContent,
        };
    } catch (err) {
        console.error("Failed to fetch RD from R2 using S3Client:", err);
        return {
            success: false,
            // Returning the specific error message can help with debugging missing keys
            error: err.message || "Failed to fetch RD from R2",
        };
    }
}

export async function updateR2Rd(r2Key, rdHtml, contentType = "text/html") {
    try {
        const command = new PutObjectCommand({
            Bucket: getR2Bucket("rd"),
            Key: r2Key,
            Body: rdHtml,
            ContentType: contentType,
        });
        await s3.send(command);
        const purgeRes = await fetch(
            `https://rd.datainsightsmarket.com/${r2Key}?key=${process.env.R2_RD_AUTH_KEY}`,
            {
                method: "DELETE",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            },
        );
        const purgeData = await purgeRes.json().catch(() => ({}));
        console.log(`🧹 RD cache purge result for ${r2Key}:`, purgeData);

        return {
            success: true,
        };
    } catch (error) {
        console.error("Failed to upload RD to R2:", error);
        return {
            success: false,
            error: "Failed to upload RD to R2",
        };
    }
}

export async function updateR2Asset(r2Key, rdHtml, contentType = "text/html") {
    try {
        const command = new PutObjectCommand({
            Bucket: getR2Bucket("rm"),
            Key: r2Key,
            Body: rdHtml,
            ContentType: contentType,
        });
        await s3.send(command);
        return {
            success: true,
        };
    } catch (error) {
        console.error("Failed to upload RD to R2:", error);
        return {
            success: false,
            error: "Failed to upload RD to R2",
        };
    }
}

export async function readR2RM(key) {
    try {
        const resp = await s3.send(
            new GetObjectCommand({ Bucket: getR2Bucket("rm"), Key: key }),
        );
        const body = await resp.Body.transformToString();
        return JSON.parse(body);
    } catch (err) {
        console.warn(`[readR2RM] Failed to read key "${key}":`, err.message);
        return null;
    }
}

export async function updateR2Content(
    r2Key,
    content,
    contentType = "text/html",
    bucket = "rd",
) {
    try {
        const command = new PutObjectCommand({
            Bucket: getR2Bucket(bucket),
            Key: r2Key,
            Body: content,
            ContentType: contentType,
        });
        await s3.send(command);
        return {
            success: true,
        };
    } catch (error) {
        console.error(`Failed to upload ${r2Key} to R2 (${bucket} bucket):`, error.message || error);
        return {
            success: false,
            error: error.message || "Failed to upload to R2",
        };
    }
}

export async function readR2Content(key, bucket = "rd") {
    try {
        const resp = await s3.send(
            new GetObjectCommand({ Bucket: getR2Bucket(bucket), Key: key }),
        );
        const body = await resp.Body.transformToString();
        return JSON.parse(body);
    } catch (err) {
        console.warn(`[readR2RM] Failed to read key "${key}":`, err.message);
        return null;
    }
}


function getR2Bucket(type) {
    try {
        switch (type) {
            case "rd":
                return process.env.RD_BUCKET;
            case "rm":
                return process.env.RM_BUCKET;
            case "company":
                return process.env.COMPANY_BUCKET;
            case "cs":
                return process.env.CS_BUCKET;
            case "image":
                return process.env.AMPLIFY_BUCKET || process.env.IMAGE_BUCKET || "multisite-public";
            default:
                return process.env.AMPLIFY_BUCKET || process.env.IMAGE_BUCKET || "multisite-public";
        }
    } catch (error) {
        console.error("Failed to get R2 bucket:", error);
        return null;
    }
}


// getR2Rd("rd/dim/en/195465.html").catch(err => {
//     console.error(err);
//     process.exit(1);
// })