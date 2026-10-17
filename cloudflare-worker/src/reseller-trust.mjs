// Public verification material only. The private signer stays in the reseller Site.
export const TRUSTED_RESELLER=Object.freeze({accountId:'be5f1fc0-d772-4683-9c6f-2bcdee5a4e70',keyId:'FLYIFb514h-MsX4jJ5tYuIvp5KC1rjKa',publicKey:'p0PP5S1soh7oFcAKmf6kCwh7v3tktn8WSxzuY2pg3Vc'});

// Additional scopes have no owner, portal configuration, native import or provider export authority.
export const RESELLER_SERVICE_ACTIONS=Object.freeze(['integrity','history.clients','presence.close','presence.connections','presence.summary','presence','probe','reserve','release','apply']);
export const TRUSTED_RESELLERS=Object.freeze([TRUSTED_RESELLER,Object.freeze({accountId:'ccf-account-3350',keyId:'A7Wpf7SUfQRMEr2MlKyUgDbVzFc6gLFn',publicKey:'BrnQ3fdSeXpe_rvlmweK1Z8NRJ2v0ULWs_mB_F73z5s',actions:RESELLER_SERVICE_ACTIONS}),Object.freeze({accountId:'ccf-account-2615',keyId:'TjrAjC_xnZ5r_OLwBuXUYpnZsXPTWF-u',publicKey:'aMBPlqqz6kRHGLGrEMeYbyzGy6Y02N0ixnUvMCjkmZU',actions:RESELLER_SERVICE_ACTIONS}),Object.freeze({accountId:'ccf-account-3110',keyId:'TIrkzuocixf6QdgQsZPIL4C_T9qMwgGO',publicKey:'pqmfICa6PkyaOH8tKTJPZlPNhaDxtu3lLgZMKzryfLU',actions:RESELLER_SERVICE_ACTIONS})]);
