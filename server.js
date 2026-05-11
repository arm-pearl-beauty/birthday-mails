require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const createCsvWriter =
    require("csv-writer")
        .createObjectCsvWriter;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));




const SHOP = process.env.SHOP;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

const csvWriter = createCsvWriter({

    path: "customers.csv",

    header: [

        {
            id: "email",
            title: "EMAIL"
        },

        {
            id: "phone",
            title: "PHONE"
        },

        {
            id: "birthday",
            title: "BIRTHDAY"
        },

        {
            id: "savedAt",
            title: "SAVED_AT"
        }

    ],

    append: fs.existsSync("customers.csv")

});

const GRAPHQL_URL =
    `https://${SHOP}/admin/api/2024-01/graphql.json`;




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

        console.log(
            "GraphQL Error:",
            error.response?.data || error.message
        );

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
            !phone ||
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
                    query: `email:${email.trim().toLowerCase()}`
                }
            );



        let customer =
            customerResponse
                .data
                .customers
                .edges[0]?.node;





        let customerId;

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
                                query: `email:${email.trim().toLowerCase()}`
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
                            value: birthday,
                        }
                    ]
                }
            );






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

        // CHECK DUPLICATE EMAIL
        const existingData =
            fs.existsSync("customers.csv")

                ? fs.readFileSync(
                    "customers.csv",
                    "utf8"
                )

                : "";



        if (
            !existingData.includes(email)
        ) {

            await csvWriter.writeRecords([

                {
                    email,
                    phone,
                    birthday,

                    savedAt:
                        new Date()
                            .toISOString()
                }

            ]);

        }



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




app.get(
    "/download-customers",

    (req, res) => {

        res.download(
            "customers.csv"
        );

    }
);


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