 Authentication — login, JWT access/refresh token generation & regeneration
 OTP — send, resend, verify (email + mobile)
 Forgot password / password change
 Social login — Apple Sign‑In (app + web callbacks)
 Logout / token revocation
 RBAC (ACL) — roles CRUD, permissions, role‑permission mapping & checks
 Middleware chain — token validation, user‑type gating (admin/customer/agent), permission checks
 Security — helmet headers, CORS, rate limiting, AES payload encryption, cookies
 Product management — add/edit, draft → publish workflow, variations, pricing, featured/recommended toggles
Product catalog — admin/customer product lists, details, filters
Master data — categories, brands, colors, units, states, company info
CMS — terms & privacy, CMS content CRUD
Cart — add to cart, cart list, cart delete
Orders — place order, order lists (admin/customer/agent), order detail, update, status update
Payments — payment status update, paid order list/detail
GST invoices — invoice list, PDF generation, invoice regeneration
Delivery — distance slabs, pincode serviceability, warehouse mapping
Coupons — CRUD + apply coupon with redemptions
Discounts — CRUD with discount targets
Customers — list/detail, profile update, account delete, dashboard
Address book — add/update/remove addresses, set default
Wishlist & recent searches
Customer mobile OTP verification
Leads — CRUD, profile, sample request list/detail
Admin users — CRUD, detail, dashboard & dashboard graph
Reports — pending orders, agent performance, sample requests, sales summary, product sales
Banners — draft/save, mobile & web images, publish, customer detail
FAQ — CRUD
Deep links resolver
SEO management — draft → published SEO records, detail endpoint, OG image resolution
File service — S3 upload/delete, multipart uploads, sharp image resize & thumbnails, set main image
Email — SES + SMTP with EJS templates (order, invoice, password, account deleted)
Queues/messaging — AWS SQS helpers, SNS helper
i18n — English/Hindi translations with per‑request language









Mgroc is a grocery e-commerce platform covering:
- Secure authentication, OTP and multilingual support
- Product, category, brand and file management
- Customer accounts, addresses, wishlist and cart
- Checkout, pricing, payments and GST invoices
- Admin roles, staff, delivery agents and reporting
- Banners, CMS, SEO and transactional emails
- Warehouses, expenses, leads and order management
The plan contains 41 features across customer, administration and business operations