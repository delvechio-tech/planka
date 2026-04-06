/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /sso/chatwoot:
 *   post:
 *     summary: SSO login via Chatwoot
 *     description: Authenticates a user via SSO from Chatwoot using email. Creates user if not exists.
 *     tags:
 *       - SSO
 *     operationId: ssoChatwoot
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address of the user from Chatwoot
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: Login successful or user created and logged in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   type: string
 *                   description: Access token for API authentication
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ4...
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         description: Internal server error
 */

const crypto = require('crypto');
const { getRemoteAddress } = require('../../../utils/remote-address');

module.exports = {
  inputs: {
    email: {
      type: 'string',
      isEmail: true,
      required: true,
    },
  },

  exits: {
    success: {
      description: 'SSO authentication successful.',
    },
  },

  async fn(inputs) {
    const remoteAddress = getRemoteAddress(this.req);

    // Try to find existing user by email
    let user = await User.qm.getOneActiveByEmail(inputs.email);

    if (!user) {
      // User doesn't exist, create one with random password and SSO flag
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const name = inputs.email.split('@')[0]; // Use part before @ as name

      const values = {
        email: inputs.email,
        password: randomPassword, // Will be hashed by the helper
        role: User.Roles.BOARD_USER, // Default role for SSO users
        name: name.charAt(0).toUpperCase() + name.slice(1), // Capitalize first letter
        isSsoUser: true, // Mark as SSO user
      };

      user = await sails.helpers.users.createOne.with({
        values,
        actorUser: null, // No actor for SSO creation
        request: this.req,
      }).intercept('emailAlreadyInUse', () => {
        // If email already in use (race condition), fetch the user again
        return User.qm.getOneActiveByEmail(inputs.email);
      }).intercept('usernameAlreadyInUse', () => {
        // Ignore username conflicts for SSO users (they might not have usernames set anyway)
      }).intercept('activeLimitReached', () => {
        throw new Error('Active user limit reached');
      });
    } else if (user.isSsoUser !== true) {
      // If user exists but is not an SSO user, we could either reject or allow based on policy
      // For now, allow existing users to login via SSO as well, but don't change their isSsoUser flag
    } else if (user.isDeactivated) {
      throw new Error('User account is deactivated');
    }

    // Generate access token using the same helper as regular login
    return sails.helpers.accessTokens.handleSteps.with({
      user,
      remoteAddress,
      request: this.req,
      response: this.res,
      withHttpOnlyToken: false, // For iframe SSO, probably don't need HTTP-only cookie
    }).intercept('adminLoginRequiredToInitializeInstance', (error) => ({
      adminLoginRequiredToInitializeInstance: error.raw,
    })).intercept('termsAcceptanceRequired', (error) => ({
      termsAcceptanceRequired: error.raw,
    }));
  },
};