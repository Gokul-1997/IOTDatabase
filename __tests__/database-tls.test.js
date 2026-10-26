import { databaseTls, redisTls } from '../src/lib/database-tls.js';
test('existing installations retain their explicit TLS configuration', () => { expect(databaseTls({})).toBe(false); expect(databaseTls({DB_SSL:'false'})).toBe(false); });
test('enabled TLS always verifies the server certificate', () => expect(databaseTls({DB_SSL:'true'})).toEqual({rejectUnauthorized:true}));
test('invalid TLS options and missing configured CA fail closed', () => { expect(()=>databaseTls({DB_SSL:'insecure'})).toThrow();expect(()=>databaseTls({DB_SSL:'true',DB_SSL_CA_FILE:'/missing/ca-file'})).toThrow(); });
test('external Redis also verifies certificates when TLS is requested',()=>{expect(redisTls({})).toEqual({});expect(redisTls({REDIS_TLS:'true'})).toEqual({tls:true,rejectUnauthorized:true});expect(()=>redisTls({REDIS_TLS:'insecure'})).toThrow();});
