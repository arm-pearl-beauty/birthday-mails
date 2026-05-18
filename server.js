require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cron = require("node-cron");
const nodemailer = require("nodemailer");


const app = express();

app.use(cors());
app.use(express.json());

const SHOP = process.env.SHOP;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

// const transporter =
//     nodemailer.createTransport({

//         host: process.env.EMAIL_HOST,

//         port: process.env.EMAIL_PORT,

//         secure: true,

//         auth: {
//             user: process.env.EMAIL_USER,
//             pass: process.env.EMAIL_PASS,
//         },

//     });
const transporter =
    nodemailer.createTransport({

        host: "smtppro.zoho.in",

        port: 465,

        secure: true,

        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },

    });
transporter.verify(function (error, success) {

    if (error) {

        console.log("SMTP ERROR:", error);

    } else {

        console.log("SMTP READY");

    }

});

const GRAPHQL_URL =
    `https://${SHOP}/admin/api/2025-01/graphql.json`;




// SHOPIFY GRAPHQL HELPER
async function shopifyGraphQL(query, variables = {}) {

    try {

        const response = await axios.post(
            GRAPHQL_URL,
            {
                query,
                variables,
            },
            {
                headers: {
                    "X-Shopify-Access-Token": ACCESS_TOKEN,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data;

    } catch (error) {

        console.log("===============");
        console.log("SHOPIFY ERROR");
        console.log("===============");

        console.log(
            JSON.stringify(
                error.response?.data,
                null,
                2
            )
        );

        console.log(error.message);

        throw error;
    }
}


// SAVE BIRTHDAY
app.post("/save-birthday", async (req, res) => {

    try {

        const {
            email,
            phone,
            birthday,
        } = req.body;

        console.log("REQUEST DATA:", req.body);




        // VALIDATION
        if (
            !email ||

            !birthday
        ) {

            return res
                .status(400)
                .send("All fields required");

        }


        // =====================================================
        // 1. SEARCH CUSTOMER
        // =====================================================

        const FIND_CUSTOMER_QUERY = `
      query getCustomer($query: String!) {

        customers(first: 1, query: $query) {

          edges {

            node {
              id
              email

              metafield(
                namespace: "custom",
                key: "birthday"
              ) {
                value
              }
            }
          }
        }
      }
    `;


        const customerResponse =
            await shopifyGraphQL(
                FIND_CUSTOMER_QUERY,
                {
                    query: `email:${email
                        .trim()
                        .toLowerCase()
                        .replace(/'/g, "")}`
                }
            );



        let customer =
            customerResponse
                .data
                .customers
                .edges[0]?.node;





        let customerId;
        console.log(
            "CUSTOMER RESPONSE:",
            JSON.stringify(
                customerResponse,
                null,
                2
            )
        );
        // =====================================================
        // 2. CUSTOMER EXISTS
        // =====================================================

        if (customer) {

            console.log("Existing Customer Found");

            customerId = customer.id;

            // BIRTHDAY ALREADY EXISTS
            if (customer.metafield?.value) {

                return res.send(
                    "Birthday already saved"
                );

            }

        } else {

            // =====================================================
            // 3. CREATE CUSTOMER
            // =====================================================

            console.log("Creating New Customer");

            const CREATE_CUSTOMER_MUTATION = `
        mutation customerCreate(
          $input: CustomerInput!
        ) {

          customerCreate(input: $input) {

            customer {
              id
              email
            }

            userErrors {
              field
              message
            }
          }
        }
      `;

            const createResponse =
                await shopifyGraphQL(
                    CREATE_CUSTOMER_MUTATION,
                    {
                        input: {
                            email,
                            phone,
                            tags: [
                                "Birthday Popup"
                            ],
                        }
                    }
                );


            const createData =
                createResponse
                    .data
                    .customerCreate;


            // HANDLE SHOPIFY ERRORS
            if (
                createData.userErrors.length > 0
            ) {

                const emailExists =
                    createData.userErrors.some(
                        err =>
                            err.message
                                .toLowerCase()
                                .includes("taken")
                    );





                // EMAIL ALREADY EXISTS
                if (emailExists) {

                    console.log(
                        "Customer already exists. Re-searching..."
                    );





                    // SEARCH AGAIN
                    const retrySearch =
                        await shopifyGraphQL(
                            FIND_CUSTOMER_QUERY,
                            {
                                query: `email:${email
                                    .trim()
                                    .toLowerCase()
                                    .replace(/'/g, "")}`
                            }
                        );





                    const retryCustomer =
                        retrySearch
                            .data
                            .customers
                            .edges[0]?.node;





                    if (!retryCustomer) {

                        return res
                            .status(400)
                            .send(
                                "Customer exists but could not retrieve."
                            );

                    }





                    customerId =
                        retryCustomer.id;

                } else {

                    return res
                        .status(400)
                        .send(
                            createData.userErrors[0].message
                        );

                }

            } else {

                customerId =
                    createData.customer.id;

            }

        }


        // =====================================================
        // 4. SAVE BIRTHDAY METAFIELD
        // =====================================================

        const SET_METAFIELD_MUTATION = `
      mutation setMetafields(
        $metafields: [MetafieldsSetInput!]!
      ) {

        metafieldsSet(
          metafields: $metafields
        ) {

          metafields {
            key
            value
          }

          userErrors {
            field
            message
          }
        }
      }
    `;






        const metafieldResponse =
            await shopifyGraphQL(
                SET_METAFIELD_MUTATION,
                {
                    metafields: [
                        {
                            ownerId: customerId,
                            namespace: "custom",
                            key: "birthday",
                            type: "date",
                            value: new Date(birthday)
                                .toISOString()
                                .split("T")[0],
                        }
                    ]
                }
            );

        console.log("===============");
        console.log("METAFIELD RESPONSE");
        console.log("===============");

        console.log(
            JSON.stringify(
                metafieldResponse,
                null,
                2
            )
        );

        const metafieldData =
            metafieldResponse?.data?.metafieldsSet;

        if (
            !metafieldData
        ) {

            console.log(
                "Metafield response missing"
            );

            return res
                .status(400)
                .send(
                    "Metafield failed"
                );
        }




        const metafieldErrors =
            metafieldResponse
                .data
                .metafieldsSet
                .userErrors;





        if (
            metafieldErrors.length > 0
        ) {

            console.log(
                "Metafield Error:",
                metafieldErrors
            );

            return res
                .status(400)
                .send(
                    metafieldErrors[0].message
                );

        }






        console.log("Birthday Saved");
        // ===========================================================
        // ==============================================================

        // SEND TO GOOGLE SHEETS
        try {

            // SEND TO GOOGLE SHEETS
            await axios.post(

                "https://script.google.com/macros/s/AKfycby5VM4JL5qyV5MuFhU-cyIqXULVoIumByMsOyNV5ZfRKLiK5qUYl_wng5qlR8GNE5EM/exec",

                {
                    email,
                    phone,

                    birthday:
                        metafieldResponse
                            .data
                            .metafieldsSet
                            .metafields[0]
                            .value
                },

                {
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                }
            );

            console.log(
                "Google Sheet Updated"
            );

        } catch (sheetError) {

            console.log(
                "Google Sheet Error:",
                sheetError.message
            );

        }
        // ===================================================================
        // ===================================================================

        res.send(
            "Birthday saved successfully"
        );

    } catch (error) {

        console.log(
            error.response?.data ||
            error.message
        );

        res
            .status(500)
            .send("Error saving birthday");

    }

});

// =======================ADD BIRTHDAY EMAIL FUNCTION=================================================================

// async function sendBirthdayEmails() {

//     try {

//         console.log("Checking birthdays...");

//         const today = new Date();

//         const currentYear =
//             today.getFullYear();

//         const month =
//             String(today.getMonth() + 1)
//                 .padStart(2, "0");

//         const day =
//             String(today.getDate())
//                 .padStart(2, "0");

//         const todayMonthDay =
//             `${month}-${day}`;



//         // GET CUSTOMERS
//         const query = `

//     query {

//       customers(first: 250) {

//         edges {

//           node {

//             id
//             firstName
//             email

//             birthday: metafield(
//               namespace: "custom",
//               key: "birthday"
//             ) {
//               value
//             }

//             lastMail: metafield(
//               namespace: "custom",
//               key: "last_birthday_email_sent"
//             ) {
//               value
//             }

//           }

//         }

//       }

//     }

//     `;



//         const response =
//             await shopifyGraphQL(query);

//         const customers =
//             response.data.customers.edges;



//         for (const item of customers) {

//             const customer = item.node;



//             // SKIP EMPTY
//             if (
//                 !customer.email ||
//                 !customer.birthday?.value
//             ) {
//                 continue;
//             }



//             const birthday =
//                 customer.birthday.value;

//             const birthdayMonthDay =
//                 birthday.slice(5);



//             // DATE NOT MATCH
//             if (
//                 birthdayMonthDay !==
//                 todayMonthDay
//             ) {
//                 continue;
//             }



//             // ALREADY SENT
//             if (
//                 customer.lastMail?.value ===
//                 String(currentYear)
//             ) {

//                 console.log(
//                     `Already sent to ${customer.email}`
//                 );

//                 continue;
//             }



//             console.log(
//                 `Sending birthday email to ${customer.email}`
//             );



//             // SEND EMAIL
//             await transporter.sendMail({

//                 from:
//                     `"Arm Pearl Beauty" <hello@armpealbeauty.com>`,

//                 to: `sandhyag@armpearlbeauty.com`,

//                 subject:
//                     "🎉 Happy Birthday From Arm Pearl Beauty",

//                 html: `

//         <div style="
//           max-width:600px;
//           margin:auto;
//           padding:30px;
//           background:#fff7f7;
//           font-family:Arial;
//         ">

//           <h1 style="
//             color:#a51e27;
//             text-align:center;
//           ">
//             Happy Birthday 🎂
//           </h1>

//           <p style="
//             font-size:16px;
//             line-height:1.8;
//             text-align:center;
//           ">
//             Wishing you a beautiful birthday filled with happiness & joy 💖
//           </p>

//           <div style="
//             text-align:center;
//             margin:30px 0;
//           ">

//             <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/PigmentationCream1.jpg?v=1774346370"
//               width="220"
//               style="
//                 border-radius:12px;
//               "
//             />

//              <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/Nightrevive.jpg?v=1764939667"
//               width="220"
//               style="
//                 border-radius:12px;
//               "
//             />

//              <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/body_glow_moisturiser_product_image.jpg?v=1765018739"
//               width="220"
//               style="
//                 border-radius:12px;
//               "
//             />

//              <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/Old_Glowing_Night_Cream_1250_X_1250.jpg?v=1758371497"
//               width="220"
//               style="
//                 border-radius:12px;
//               "
//             />

//           </div>

//           <div style="
//             text-align:center;
//           ">

//             <a
//               href="https://armpearlbeauty.com"
//               style="
//                 background:#a51e27;
//                 color:white;
//                 padding:14px 28px;
//                 text-decoration:none;
//                 border-radius:8px;
//                 display:inline-block;
//                 font-weight:bold;
//               "
//             >
//               Shop Now
//             </a>

//           </div>

//         </div>

//         `,
//             });





//             // SAVE SENT YEAR
//             await shopifyGraphQL(

//                 `
//       mutation metafieldsSet(
//         $metafields: [MetafieldsSetInput!]!
//       ) {

//         metafieldsSet(
//           metafields: $metafields
//         ) {

//           metafields {
//             key
//             value
//           }

//         }

//       }
//       `,

//                 {

//                     metafields: [

//                         {

//                             ownerId: customer.id,

//                             namespace: "custom",

//                             key: "last_birthday_email_sent",

//                             type: "single_line_text_field",

//                             value: String(currentYear),

//                         }

//                     ]

//                 }

//             );



//             console.log(
//                 `Birthday email sent to ${customer.email}`
//             );

//         }

//     } catch (error) {

//         console.log(
//             "Birthday Email Error:",
//             error.message
//         );

//     }

// }

// =================================ADD CRON JOB=========================================

// cron.schedule("0 8 * * *", () => {

//     console.log(
//         "Running birthday email cron..."
//     );

//     sendBirthdayEmails();

// });

// ============================================
// async function sendTestEmail() {

//     try {

//         await transporter.sendMail({

//             from:
//                 `"Arm Pearl Beauty" <hello@armpearlbeauty.com>`,

//             to: "gurramsandhya2013@gmail.com",

//             subject:
//                 "🎉 Birthday Test Mail",

//             html: `

//       <div style="
//         max-width:600px;
//         margin:auto;
//         padding:30px;
//         background:#fff7f7;
//         font-family:Arial;
//       ">

//         <h1 style="
//           color:#a51e27;
//           text-align:center;
//         ">
//           Happy Birthday 🎂
//         </h1>

//         <p style="
//           font-size:16px;
//           line-height:1.8;
//           text-align:center;
//         ">
//           Happy Birthday from all of us at ARM Pearl Beauty! 💖
//         </p>
//         <p>Your special day deserves a little extra glow, so here’s a small birthday treat from us. Enjoy 5% OFF on your favorite skincare and beauty products.</p>
//         <p>Treat yourself to something your skin will love.</p>
//         <div style="
//           text-align:center;
//           margin:20px 0;
//         ">

//           <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/PigmentationCream1.jpg?v=1774346370"
//               width="250"
//               style="
//                 border-radius:12px;
//               "
//             />

//              <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/Nightrevive.jpg?v=1764939667"
//               width="250"
//               style="
//                 border-radius:12px;
//               "
//             />

//              <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/body_glow_moisturiser_product_image.jpg?v=1765018739"
//               width="250"
//               style="
//                 border-radius:12px;
//               "
//             />

//              <img
//               src="https://cdn.shopify.com/s/files/1/0770/5319/8575/files/Old_Glowing_Night_Cream_1250_X_1250.jpg?v=1758371497"
//               width="250"
//               style="
//                 border-radius:12px;
//               "
//             />

//         </div>

//         <div style="
//           text-align:center;
//         ">

//           <a
//             href="https://armpearlbeauty.com"
//             style="
//               background:#a51e27;
//               color:white;
//               padding:14px 28px;
//               border-radius:8px;
//               text-decoration:none;
//               display:inline-block;
//               font-weight:bold;
//             "
//           >
//             Shop Now
//           </a>

//         </div>

//       </div>

//       `,
//         });

//         console.log("Test email sent successfully");

//     } catch (error) {

//         console.log(
//             "Test Mail Error:",
//             error.message
//         );

//     }

// }

// sendTestEmail();
// ============================================================

app.listen(PORT, () => {

    console.log(
        `Server running on ${PORT}`
    );

});





// ==================================================================================================================================================================
// ====================================================================================================================================================================






// require("dotenv").config();

// const express = require("express");
// const axios = require("axios");
// const cors = require("cors");

// const app = express();
// app.use(cors());

// app.use(express.json());

// const SHOP = process.env.SHOP;
// const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// const PORT = process.env.PORT || 3000;


// // SAVE BIRTHDAY
// app.post("/save-birthday", async (req, res) => {

//     try {

//         const {
//             email,
//             phone,
//             birthday
//         } = req.body;

//         console.log("REQUEST DATA:", req.body);

//         // VALIDATION
//         if (
//             !email ||
//             !phone ||
//             !birthday
//         ) {

//             return res
//                 .status(400)
//                 .send("All fields required");

//         }

//         let customerId;



//         const customerData = {
//             email,
//             phone,
//         };

//         const searchResponse = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers/search.json?query=email:${email}`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const existingCustomer =
//             searchResponse.data.customers[0];

//         // 2. CUSTOMER EXISTS
//         if (existingCustomer) {

//             console.log("Existing Customer Found");

//             customerId = existingCustomer.id;

//         } else {

//             console.log("Creating New Customer");

//             // 3. CREATE NEW CUSTOMER
//             const createCustomer = await axios.post(
//                 `https://${SHOP}/admin/api/2024-01/customers.json`,
//                 {
//                     customer: {
//                         email,
//                         phone,
//                         tags: "Birthday Popup",
//                     },
//                 },
//                 {
//                     headers: {
//                         "X-Shopify-Access-Token": ACCESS_TOKEN,
//                         "Content-Type": "application/json",
//                     },
//                 }
//             );

//             customerId =
//                 createCustomer.data.customer.id;

//         }


//         // CHECK EXISTING METAFIELDS
//         const metafieldCheck = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers/${customerId}/metafields.json`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const existingBirthday =
//             metafieldCheck.data.metafields.find(
//                 (m) =>
//                     m.namespace === "custom" &&
//                     m.key === "birthday"
//             );



//         // ALREADY EXISTS
//         if (existingBirthday) {

//             return res.send(
//                 "Birthday already saved"
//             );

//         }


//         // 4. SAVE BIRTHDAY METAFIELD
//         await axios.post(
//             `https://${SHOP}/admin/api/2024-01/customers/${customerId}/metafields.json`,
//             {
//                 metafield: {
//                     namespace: "custom",
//                     key: "birthday",
//                     type: "date",
//                     value: birthday,
//                 },
//             },
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                     "Content-Type": "application/json",
//                 },
//             }
//         );
//         console.log("Birthday Saved");

//         res.send("Birthday saved successfully");

//     } catch (error) {

//         console.log(
//             error.response?.data || error.message
//         );

//         res.status(500).send("Error saving birthday");

//     }

// });

// app.listen(PORT, () => {

//     console.log(`Server running on ${PORT}`);

// });



// ==========================================================================================================================================================================
// ============================================================================================================================================================================


// require("dotenv").config();

// const express = require("express");
// const axios = require("axios");
// const cors = require("cors");
// const cron = require("node-cron");

// const app = express();

// app.use(express.json());
// app.use(cors());

// const SHOP = process.env.SHOP;
// const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
// const PORT = process.env.PORT || 3000;





// // ==========================================
// // CHECK LOGIN STATUS
// // ==========================================
// app.get("/check-customer", async (req, res) => {

//     try {

//         const customerToken = req.headers.cookie;

//         if (!customerToken) {
//             return res.json({
//                 loggedIn: false
//             });
//         }

//         return res.json({
//             loggedIn: true
//         });

//     } catch (err) {

//         console.log(err.message);

//         res.json({
//             loggedIn: false
//         });

//     }

// });






// // ==========================================
// // SAVE BIRTHDAY
// // ==========================================
// app.post("/save-birthday", async (req, res) => {

//     try {

//         const { email, birthday } = req.body;

//         if (!email || !birthday) {
//             return res.status(400).send("Missing data");
//         }

//         // SEARCH CUSTOMER
//         const customerRes = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers/search.json?query=email:${email}`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const customer = customerRes.data.customers[0];

//         if (!customer) {
//             return res.status(404).send("Customer not found");
//         }

//         // GET METAFIELDS
//         const metafieldsRes = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers/${customer.id}/metafields.json`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const existing = metafieldsRes.data.metafields.find(
//             (m) =>
//                 m.namespace === "custom" &&
//                 m.key === "birthday"
//         );

//         // UPDATE
//         if (existing) {

//             await axios.put(
//                 `https://${SHOP}/admin/api/2024-01/metafields/${existing.id}.json`,
//                 {
//                     metafield: {
//                         id: existing.id,
//                         value: birthday,
//                         type: "date",
//                     },
//                 },
//                 {
//                     headers: {
//                         "X-Shopify-Access-Token": ACCESS_TOKEN,
//                     },
//                 }
//             );

//         } else {

//             // CREATE
//             await axios.post(
//                 `https://${SHOP}/admin/api/2024-01/customers/${customer.id}/metafields.json`,
//                 {
//                     metafield: {
//                         namespace: "custom",
//                         key: "birthday",
//                         type: "date",
//                         value: birthday,
//                     },
//                 },
//                 {
//                     headers: {
//                         "X-Shopify-Access-Token": ACCESS_TOKEN,
//                     },
//                 }
//             );

//         }

//         res.send("Birthday saved 🎉");

//     } catch (err) {

//         console.log(err.response?.data || err.message);

//         res.status(500).send("Error saving birthday");

//     }

// });







// // ==========================================
// // SEND BIRTHDAY EMAIL
// // ==========================================
// async function sendBirthdayEmail(email, name) {

//     console.log(`Sending birthday email to ${email}`);

//     // ADD KLAVIYO / SMTP / SENDGRID HERE

// }







// // ==========================================
// // DAILY CRON
// // ==========================================
// cron.schedule("0 9 * * *", async () => {

//     console.log("Running birthday cron");

//     try {

//         const res = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers.json?limit=250`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const customers = res.data.customers;

//         const today = new Date();

//         const todayMonth = today.getMonth() + 1;

//         const todayDate = today.getDate();

//         for (let customer of customers) {

//             const metafieldsRes = await axios.get(
//                 `https://${SHOP}/admin/api/2024-01/customers/${customer.id}/metafields.json`,
//                 {
//                     headers: {
//                         "X-Shopify-Access-Token": ACCESS_TOKEN,
//                     },
//                 }
//             );

//             const birthdayField = metafieldsRes.data.metafields.find(
//                 (m) =>
//                     m.namespace === "custom" &&
//                     m.key === "birthday"
//             );

//             if (!birthdayField) continue;

//             const birthday = new Date(birthdayField.value);

//             const month = birthday.getMonth() + 1;

//             const day = birthday.getDate();

//             if (
//                 month === todayMonth &&
//                 day === todayDate
//             ) {

//                 console.log("Birthday Found:", customer.email);

//                 await sendBirthdayEmail(
//                     customer.email,
//                     customer.first_name
//                 );

//             }

//         }

//     } catch (err) {

//         console.log("Cron Error:", err.message);

//     }

// });






// // ==========================================
// // SERVER
// // ==========================================
// app.listen(PORT, () => {

//     console.log(`Server running on port ${PORT}`);

// });


// ===========================================================================================================================================================

// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const cors = require("cors");
// const cron = require("node-cron");


// const app = express();
// app.use(express.json());
// app.use(cors());

// const SHOP = process.env.SHOP;
// const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
// const PORT = process.env.PORT || 3000;

// // SAVE BIRTHDAY
// app.post("/save-birthday", async (req, res) => {
//     try {
//         const { email, birthday } = req.body;

//         // 1. Get customer
//         const customerRes = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers/search.json?query=email:${email}`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const customer = customerRes.data.customers[0];

//         if (!customer) {
//             return res.status(404).send("Customer not found");
//         }

//         // 2. Save metafield
//         // 2. Check existing metafield
//         const metafieldsRes = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers/${customer.id}/metafields.json`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const existing = metafieldsRes.data.metafields.find(
//             (m) => m.namespace === "custom" && m.key === "birthday"
//         );

//         // 3. Update or create
//         if (existing) {
//             // UPDATE
//             await axios.put(
//                 `https://${SHOP}/admin/api/2024-01/metafields/${existing.id}.json`,
//                 {
//                     metafield: {
//                         id: existing.id,
//                         value: birthday,
//                         type: "date",
//                     },
//                 },
//                 {
//                     headers: {
//                         "X-Shopify-Access-Token": ACCESS_TOKEN,
//                     },
//                 }
//             );
//         } else {
//             // CREATE
//             await axios.post(
//                 `https://${SHOP}/admin/api/2024-01/customers/${customer.id}/metafields.json`,
//                 {
//                     metafield: {
//                         namespace: "custom",
//                         key: "birthday",
//                         type: "date",
//                         value: birthday,
//                     },
//                 },
//                 {
//                     headers: {
//                         "X-Shopify-Access-Token": ACCESS_TOKEN,
//                     },
//                 }
//             );
//         }

//         res.send("Saved 🎉");
//     } catch (err) {
//         console.log(err.response?.data || err.message);
//         res.status(500).send("Error");
//     }
// });



// // RUN DAILY AT 9 AM
// cron.schedule("0 9 * * *", async () => {
//     console.log("Running birthday job...");

//     try {
//         // 1. Get all customers
//         const res = await axios.get(
//             `https://${SHOP}/admin/api/2024-01/customers.json?limit=250`,
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": ACCESS_TOKEN,
//                 },
//             }
//         );

//         const customers = res.data.customers;

//         const today = new Date();
//         const todayMonth = today.getMonth() + 1;
//         const todayDate = today.getDate();

//         for (let customer of customers) {
//             // 2. Get metafields
//             const metafieldsRes = await axios.get(
//                 `https://${SHOP}/admin/api/2024-01/customers/${customer.id}/metafields.json`,
//                 {
//                     headers: {
//                         "X-Shopify-Access-Token": ACCESS_TOKEN,
//                     },
//                 }
//             );

//             const birthdayField = metafieldsRes.data.metafields.find(
//                 (m) => m.namespace === "custom" && m.key === "birthday"
//             );

//             if (!birthdayField) continue;

//             const birthday = new Date(birthdayField.value);

//             const bMonth = birthday.getMonth() + 1;
//             const bDate = birthday.getDate();

//             // 🎯 MATCH DATE
//             if (bMonth === todayMonth && bDate === todayDate) {
//                 console.log("Birthday found:", customer.email);

//                 // 👉 SEND EMAIL HERE
//                 await sendBirthdayEmail(customer.email, customer.first_name);
//             }
//         }
//     } catch (err) {
//         console.log("Cron error:", err.message);
//     }
// });



// app.listen(3000, () => console.log("Server running"));