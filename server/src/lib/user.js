import prisma from "./db.js";

/**
 * Find a user by their session access token
 * @param {string} accessToken - The session access token
 * @returns {Promise<{id: string, name: string, email: string, image: string|null}|null>}
 */
export async function getUserByToken(accessToken) {
    return prisma.user.findFirst({
        where: {
            sessions: {
                some: { token: accessToken },
            },
        },
        select: {
            id: true,
            name: true,
            email: true,
            image: true,
        },
    });
}
