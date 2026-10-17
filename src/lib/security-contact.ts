/** Where security reports go: SECURITY_CONTACT_EMAIL, or the default address. */
export const securityContact = () => process.env.SECURITY_CONTACT_EMAIL?.trim() || 'security@preciopsatms.com';
