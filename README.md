EID Tracker – Backend (Accounts + Razorpay)
Ye backend do kaam karta hai:
Accounts — register/login/change-pin, aur ek time pe sirf ek device pe login (naye device pe login karte hi purana device apne aap logout ho jata hai).
Payments — Razorpay order banata hai, payment verify karta hai (Key Secret yahin safe rehta hai, kabhi frontend me nahi jaati).
Data (accounts + saara farm data) ab MongoDB me store hota hai — isliye ek baar login karke jo data save karo, wahi kisi bhi phone se login karke dikhega.
Naya kya hai (pehle se)
/api/register, /api/login, /api/logout, /api/change-pin, /api/change-mobile
/api/account (GET) — apna data fetch karne ke liye
/api/account/data (PUT) — apna data save karne ke liye
Payment routes wahi hain (/api/create-order, /api/verify-payment, /api/order-status)
Setup — MongoDB Atlas (free, hamesha ke liye free rehta hai)
mongodb.com/cloud/atlas/register pe free account banao.
"Build a Database" → M0 Free tier select karo → koi bhi region choose karke create karo.
Database Access → naya user banao (username + password yaad rakhna).
Network Access → "Allow access from anywhere" (0.0.0.0/0) add karo — Render se connect karne ke liye zaroori hai.
Connect button → "Drivers" → connection string copy karo, kuch aisa dikhega:
mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
<username> aur <password> apni values se replace karo.
Deploy (Render)
In files (server.js, package.json, README.md) ko apne backend GitHub repo me upload/replace karo.
Render Dashboard → apni service → Environment tab → ye 3 variables set karo:
RAZORPAY_KEY_ID=<aapki key>
RAZORPAY_KEY_SECRET=<aapki secret>
MONGODB_URI=<upar wali connection string>
Save karte hi Render khud redeploy karega.
Deploy hone ke baad Render Logs me MongoDB connected dikhna chahiye — agar error aaye to connection string ya Network Access step dobara check karo.
Zaroori Safety Note
.env file ya koi bhi secret/password kabhi GitHub par public repo me na daalein.
Sab secrets sirf Render ke Environment Variables me rahein.
