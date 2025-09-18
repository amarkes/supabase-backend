// Teste da extração do ID da transação
const testUrl = 'https://hlcjecnmvqjabammbdly.supabase.co/functions/v1/cashflow/transactions/86d504ef-e9f9-4d15-b133-d6f1da80ba7d/unpay'

const url = new URL(testUrl)
const pathParts = url.pathname.split('/')
const transactionId = pathParts[pathParts.length - 2]

console.log('URL:', testUrl)
console.log('Pathname:', url.pathname)
console.log('Path parts:', pathParts)
console.log('Transaction ID:', transactionId)
console.log('Expected ID: 86d504ef-e9f9-4d15-b133-d6f1da80ba7d')
console.log('Match:', transactionId === '86d504ef-e9f9-4d15-b133-d6f1da80ba7d')
