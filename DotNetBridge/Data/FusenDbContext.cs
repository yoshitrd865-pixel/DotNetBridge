using Microsoft.EntityFrameworkCore;
using DotNetBridge.Models;

namespace DotNetBridge.Data
{
    public class FusenDbContext : DbContext
    {
        public FusenDbContext(DbContextOptions<FusenDbContext> options)
            : base(options)
        {
        }

        public DbSet<FusenStore> FusenStores { get; set; }
    }
}