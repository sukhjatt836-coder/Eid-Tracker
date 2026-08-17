# EID Tracker – Razorpay Backend

Ye chhota backend server hai jo aapki Razorpay **Key Secret** ko safe rakhta hai
aur payment ka **real** success/fail verify karta hai (fake nahi).

## Ye kya karta hai
1. `/create-order` — Frontend se amount leke Razorpay par ek order banata hai.
2. `/verify-payment` — Payment ke baad Razorpay se aaya signature check karta
   hai. Agar signature match ho, tabhi payment "verified" mana jayega.
   (Ye woh step hai jo cancel/fake payment ko success dikhne se rokta hai.)
3. `/order-status/:orderId` — Kisi order ka status check karne ke liye.

## Setup (khud deploy karne ke liye)

### 1. Naya Key Secret banayein
Aapki purani secret (jo pehle share hui thi) ab unsafe hai. Razorpay Dashboard
→ Settings → API Keys → Regenerate karke naya secret lein.

### 2. Deploy kahan karein (free options)
- **Render.com** (recommended, free tier available)
- **Railway.app**
- Koi bhi Node.js hosting

### 3. Environment variables set karein
Deploy karte waqt in do variables ko **hosting ke "Environment Variables"
section mein** dalen — kisi file mein hardcode na karein:

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=<apki nayi secret>
```

### 4. Deploy
- `npm install`
- `npm start`

Deploy hone ke baad aapko ek URL milega, jaise:
`https://eid-tracker-backend.onrender.com`

Ye URL mujhe bataiye — main frontend HTML mein isse connect kar dunga taake
"Pay with UPI app" button real Razorpay Checkout khole aur payment ka asli
result (success ya cancel) dikhaye.

## Zaroori Safety Note
- `.env` file ya Key Secret **kabhi bhi GitHub par public repo mein na
  daalein**.
- Key Secret sirf hosting ke environment variables mein rahe.
